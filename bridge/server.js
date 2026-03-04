/**
 * Bridge: Telegram + HTTP (PWA) -> Cursor Cloud Agents API.
 * Run with: doppler run -- node server.js
 * Secrets come from Doppler (recommended); optional fallback: bridge/.env or environment.
 */

import { config } from 'dotenv';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirnameBridge = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirnameBridge, '.env') });

import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import * as cursor from './cursor-api.js';
import { buildChangeoutPlan } from './estimator-changeout.js';
import { buildEstimate, renderEstimateHtml } from './estimator-engine.js';
import { EstimatorValidationError } from './estimator-domain.js';
import {
  buildHousecallAppointmentLookupRequest,
  buildHousecallUpsertPlan,
  extractHousecallIdsFromObject,
} from './housecall-mapper.js';
import {
  housecallGetConfig,
  housecallRequest as mcpHousecallRequest,
  housecallTestConnection,
  housecallListCustomers,
  housecallResolveAppointmentContext,
  catalogGetIngestReport,
  catalogLoadCatalog,
} from './mcp/index.js';
import {
  getEstimatorProfile,
  replaceEstimatorCatalog,
  upsertEstimatorConfig,
} from './estimator-store.js';
import { createDispatcher } from './orchestrator-dispatch.js';
import { createRateLimiter } from './rate-limiter.js';
import { getAgentId, setAgentId, clearAgentId } from './store.js';
import { formatReplyForTelegram } from './telegram-format.js';
import { correlationMiddleware, requestLogMiddleware } from './middleware/logging.js';
import { validateBody } from './middleware/validate.js';
import {
  chatBodySchema,
  changeoutPlanBodySchema,
  estimateBodySchema,
  exportHousecallBodySchema,
  housecallRequestBodySchema,
} from './validation/schemas.js';
import { createJob, getJob, updateJob } from './jobs-store.js';
import { getIdempotencyResult, setIdempotencyResult } from './idempotency-store.js';
import { runTool, listTools } from './mcp-server/tool-runner.js';

const PORT = process.env.PORT || 3000;
const apiKey = process.env.CURSOR_API_KEY;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const agentEnvRepo = process.env.AGENT_ENV_REPO || 'https://github.com/your-org/cursor-agent-env';
const bridgeAuthToken = process.env.BRIDGE_AUTH_TOKEN;
const localActionEndpoint = process.env.LOCAL_ACTION_ENDPOINT;
const localActionAuthToken = process.env.LOCAL_ACTION_AUTH_TOKEN;
const subagentRepoAllowlist = parseCsv(process.env.SUBAGENT_REPO_ALLOWLIST);
const localActionAllowlist = parseCsv(process.env.LOCAL_ACTION_ALLOWLIST);
const rateWindowMs = Number.parseInt(process.env.BRIDGE_RATE_WINDOW_MS || '60000', 10);
const rateLimitPerWindow = Number.parseInt(process.env.BRIDGE_RATE_LIMIT_PER_WINDOW || '20', 10);

if (!apiKey) {
  console.error('Missing CURSOR_API_KEY. Run with: doppler run -- node server.js');
  process.exit(1);
}
if (!bridgeAuthToken) {
  console.error('Missing BRIDGE_AUTH_TOKEN. Refusing to start unauthenticated HTTP bridge.');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(correlationMiddleware);
app.use(requestLogMiddleware);
app.use(express.static('public'));

// ----- Helpers -----

function wrapPrompt(userMessage, isFirstMessage) {
  if (isFirstMessage) {
    return `Read MEMORY.md and today's memory/YYYY-MM-DD.md if they exist. Then respond to this request:\n\n${userMessage}`;
  }
  return userMessage;
}

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractAuthToken(req) {
  const headerToken = req.header('x-bridge-token');
  if (headerToken) return headerToken.trim();
  const authHeader = req.header('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice('bearer '.length).trim();
  }
  return '';
}

function requireBridgeAuth(req, res, next) {
  const token = extractAuthToken(req);
  if (!token || token !== bridgeAuthToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function extractUserId(req) {
  const userId = req.body?.user_id ?? req.headers['x-user-id'];
  if (!userId || typeof userId !== 'string') return '';
  return userId.trim();
}

function handleEstimatorError(err, res) {
  if (err instanceof EstimatorValidationError) {
    return res.status(400).json({ error: err.message, details: err.details ?? null });
  }
  console.error(err);
  return res.status(500).json({ error: err.message || 'Unknown estimator error' });
}

function sanitizePreview(value, maxLength = 500) {
  if (value === undefined || value === null) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function asTrimmedString(value) {
  if (value === undefined || value === null) return '';
  const normalized = `${value}`.trim();
  return normalized;
}

function mergeHousecallContext(primary = {}, fallback = {}) {
  return {
    jobId: asTrimmedString(primary.jobId || fallback.jobId),
    estimateId: asTrimmedString(primary.estimateId || fallback.estimateId),
    estimateOptionId: asTrimmedString(primary.estimateOptionId || fallback.estimateOptionId),
    appointmentId: asTrimmedString(primary.appointmentId || fallback.appointmentId),
  };
}

function isHousecallNotFound(upstream = {}) {
  if (upstream.status === 404 || upstream.status === 410) return true;
  if (upstream.status !== 400) return false;
  const bodyText =
    typeof upstream.body === 'string'
      ? upstream.body
      : JSON.stringify(upstream.body || {});
  return /not[\s_-]?found|does\s+not\s+exist|unknown/i.test(bodyText);
}

const applyRateLimit = createRateLimiter({
  windowMs: rateWindowMs,
  limitPerWindow: rateLimitPerWindow,
});

async function sendToAgent(userId, text) {
  const existingId = await getAgentId(userId);
  const isFirst = !existingId;
  const prompt = wrapPrompt(text, isFirst);

  let agentId = existingId;
  let res;

  try {
    if (existingId) {
      res = await cursor.addFollowup(apiKey, existingId, prompt);
    } else {
      res = await cursor.launchAgent(apiKey, {
        repository: agentEnvRepo,
        promptText: prompt,
      });
      agentId = res.id ?? res.agent_id;
      if (agentId) await setAgentId(userId, agentId);
    }
  } catch (e) {
    if (e.message?.startsWith('RATE_LIMITED')) {
      const [, sec] = e.message.split(':');
      await new Promise((r) => setTimeout(r, (Number.parseInt(sec, 10) || 60) * 1000));
      return sendToAgent(userId, text);
    }
    if (e.message?.includes('404') || e.message?.includes('not found')) {
      await clearAgentId(userId);
      return sendToAgent(userId, text);
    }
    throw e;
  }

  return { agentId, response: res };
}

async function getLatestAssistantMessage(agentId) {
  const conv = await cursor.getAgentConversation(apiKey, agentId);
  const messages = conv.messages ?? conv.conversation ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const role = m.role ?? m.type;
    const content = (m.content ?? m.text ?? m.parts?.map((p) => p?.text ?? p?.content).filter(Boolean).join('') ?? '').trim();
    const isAssistant =
      role === 'assistant' ||
      role === 'assistant_message' ||
      role === 'agent_message' ||
      (typeof role === 'string' && role.toLowerCase().includes('assistant'));
    if (isAssistant && content) return content;
  }
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    const preview = JSON.stringify(last).slice(0, 500);
    console.log('[getLatestAssistantMessage] No assistant content. Last message:', preview);
  }
  return '';
}

async function waitForCompletion(agentId, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 15000;
  const maxWaitMs = options.maxWaitMs ?? 300000;
  const start = Date.now();
  let lastContent = '';
  let state = 'running';
  let agent;

  while (Date.now() - start < maxWaitMs) {
    agent = await cursor.getAgent(apiKey, agentId);
    const rawState = agent.status?.state ?? agent.state;
    state = rawState === 'complete' ? 'completed' : (rawState ?? 'running');
    if (state !== 'completed' && state !== 'failed' && state !== 'stopped' && state !== 'running') {
      console.log('[waitForCompletion] Unknown agent state, raw:', rawState, 'agent.status:', agent.status, 'agent.state:', agent.state);
    }
    lastContent = await getLatestAssistantMessage(agentId);
    if (state === 'completed' || state === 'failed' || state === 'stopped') {
      return { state, lastContent };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  console.log('[waitForCompletion] Timeout. Last agent keys:', Object.keys(agent || {}), 'status:', agent?.status, 'state:', agent?.state);
  return { state: 'running', lastContent };
}

const baseUrl = process.env.BRIDGE_PUBLIC_URL || `http://127.0.0.1:${PORT}`;
const disableHousecallRequest = process.env.DISABLE_HOUSECALL_REQUEST === 'true' || process.env.DISABLE_HOUSECALL_REQUEST === '1';
const enableHousecallDebugRequest = (process.env.ENABLE_HOUSECALL_DEBUG_REQUEST === 'true' || process.env.ENABLE_HOUSECALL_DEBUG_REQUEST === '1') && !disableHousecallRequest;
const useMcpTools = process.env.USE_MCP_TOOLS === 'true' || process.env.USE_MCP_TOOLS === '1';

const dispatchOrchestratorCommands = createDispatcher({
  subagentRepoAllowlist,
  localActionAllowlist,
  launchSubagent: (params) => cursor.launchAgent(apiKey, params),
  runLocalAction: async ({ action }) => {
    if (!localActionEndpoint) {
      return { ok: false, status: 0, body: 'missing_local_action_endpoint' };
    }
    const relayRes = await fetch(localActionEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localActionAuthToken && { Authorization: `Bearer ${localActionAuthToken}` }),
      },
      body: JSON.stringify({ action }),
    });
    const relayBody = await relayRes.text();
    return { ok: relayRes.ok, status: relayRes.status, body: relayBody };
  },
  runHousecallExport: async (payload) => {
    const res = await fetch(`${baseUrl}/estimator/export/housecall`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bridge-token': bridgeAuthToken,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
    return data;
  },
});

/** Build Telegram-friendly lines from Housecall export result: customer resolution, estimate summary, notifications. */
function formatHousecallExportBlockForTelegram(exports) {
  const lines = [];
  for (const e of exports) {
    const r = e.result;
    if (r && (e.status === 'sent' || e.status === 'dry_run')) {
      const cr = r.customer_resolution;
      if (cr) {
        if (cr.used_existing && cr.customer_name) {
          lines.push(`👤 Customer: Using existing — ${cr.customer_name}`);
        } else if (cr.match_count === 0) {
          lines.push(`👤 Customer: Creating new — ${cr.customer_name || 'Customer'}`);
        } else if (cr.match_count > 1) {
          lines.push(`👤 Customer: ${cr.match_count} matches — pass housecall_customer_id or email to pick one`);
        }
      }
      if (r.estimate?.line_items?.length != null && r.estimate?.totals?.grandTotal != null) {
        const n = r.estimate.line_items.length;
        const total = Number(r.estimate.totals.grandTotal);
        const currency = r.estimate.currency || 'USD';
        const fmt =
          currency === 'USD'
            ? (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : (v) => `${Number(v).toFixed(2)} ${currency}`;
        lines.push(`📋 Summary: ${n} item(s) · ${fmt(total)} total`);
      }
      if (r.notifications_enabled === true) lines.push('🔔 Notifications: on');
      else if (r.notifications_enabled === false) lines.push('🔔 Notifications: off');
    }
    if (e.status === 'sent') lines.push('📤 Sent to Housecall Pro');
    else if (e.status === 'dry_run') lines.push('📋 Housecall dry-run ok');
    else if (e.error) lines.push(`⚠️ Housecall: ${e.error}`);
  }
  return lines;
}

// ----- HTTP (PWA) -----

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

if (useMcpTools) {
  app.get('/mcp/tools', requireBridgeAuth, (req, res) => {
    const tools = listTools();
    return res.json({ tools });
  });
  app.post('/mcp/call', requireBridgeAuth, applyRateLimit, async (req, res) => {
    const tool = req.body?.tool ?? req.body?.name;
    const args = req.body?.arguments ?? req.body?.args ?? {};
    if (!tool || typeof tool !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing tool name', code: 'VALIDATION_ERROR' });
    }
    const out = await runTool(tool.trim(), args, { allowDebugRequest: enableHousecallDebugRequest });
    if (out.ok) {
      return res.json({ ok: true, result: out.result });
    }
    return res.json({
      ok: false,
      error: out.error,
      code: out.code,
      details: out.details,
    });
  });
}

app.get('/integrations/housecall/config', requireBridgeAuth, (req, res) => {
  res.json({ housecall: housecallGetConfig() });
});

app.post('/integrations/housecall/test', requireBridgeAuth, applyRateLimit, async (req, res) => {
  try {
    const path = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const result = await housecallTestConnection(path || undefined);
    return res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      request: { method: result.method, url: result.url },
      body: result.body,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Housecall connection test failed' });
  }
});

app.post('/integrations/housecall/request', requireBridgeAuth, applyRateLimit, (req, res, next) => {
  if (!enableHousecallDebugRequest) {
    return res.status(403).json({ error: 'Housecall debug request endpoint is disabled. Set ENABLE_HOUSECALL_DEBUG_REQUEST=true to enable (and ensure DISABLE_HOUSECALL_REQUEST is not set).' });
  }
  next();
}, validateBody(housecallRequestBodySchema), async (req, res) => {
  const method = `${req.body?.method || 'GET'}`.toUpperCase();
  const path = req.body?.path;
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'Missing path' });
  }
  if (!/^\/v\d+\//.test(path) && !path.startsWith('https://') && !path.startsWith('http://')) {
    return res.status(400).json({ error: 'path must start with /v<version>/ or be an absolute URL' });
  }
  try {
    const result = await mcpHousecallRequest({
      method,
      path,
      query: req.body?.query,
      body: req.body?.body,
      headers: req.body?.headers,
    });
    return res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      request: { method: result.method, url: result.url },
      body: result.body,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Housecall request failed' });
  }
});

app.post('/integrations/housecall/resolve-context', requireBridgeAuth, applyRateLimit, async (req, res) => {
  try {
    const result = await housecallResolveAppointmentContext({
      appointment_id: req.body?.appointment_id ?? req.body?.appointmentId,
      appointment_lookup_path: req.body?.appointment_lookup_path ?? req.body?.appointmentLookupPath,
      appointment_lookup_method: req.body?.appointment_lookup_method ?? req.body?.appointmentLookupMethod,
      appointment_lookup_query: req.body?.appointment_lookup_query ?? req.body?.appointmentLookupQuery,
    });
    return res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      status: result.status,
      lookup_request: result.lookup_request,
      extracted_context: result.extracted_context,
      raw_body: result.raw_body,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Housecall context resolution failed' });
  }
});

app.get('/integrations/housecall/customers', requireBridgeAuth, applyRateLimit, async (req, res) => {
  try {
    const query = {};
    if (req.query.search != null) query.search = req.query.search;
    if (req.query.page_size != null) query.page_size = Number(req.query.page_size) || 50;
    if (req.query.page != null) query.page = Number(req.query.page) || 1;
    const result = await housecallListCustomers(query);
    if (!result.ok) return res.status(502).json({ error: 'Housecall API error', body: result.body });
    return res.json(result.body ?? {});
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Housecall customers list failed' });
  }
});

/** Normalize phone to digits for comparison. */
function normalizePhone(value) {
  if (value == null || value === '') return '';
  return String(value).replace(/\D/g, '');
}

/** Try to find an existing Housecall customer ID from estimate customer info.
 * @returns {{ customerId: string|null, matchCount: number, matchesPreview: Array<{id,first_name,last_name,email}>, customerName: string }}
 */
async function resolveCustomerIdForExport(estimate) {
  const customer = estimate?.customer;
  const customerName = (customer?.name || [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || '').trim();
  const empty = { customerId: null, matchCount: 0, matchesPreview: [], customerName: customerName || 'Customer' };

  if (!customer || typeof customer !== 'object') return empty;

  const existingId =
    customer.housecall_customer_id ||
    customer.housecallCustomerId ||
    customer.customer_id ||
    customer.customerId;
  if (existingId && String(existingId).trim()) {
    return {
      customerId: String(existingId).trim(),
      matchCount: 1,
      matchesPreview: [],
      customerName: customerName || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Customer',
    };
  }

  const name = (customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`).trim();
  const email = (customer.email || '').trim().toLowerCase();
  const phone = normalizePhone(customer.phone || customer.phone_number || '');
  if (!name && !email && !phone) return empty;

  try {
    const res = await housecallListCustomers({
      page_size: 100,
      ...(name ? { search: name } : {}),
    });
    if (!res.ok || !res.body || typeof res.body !== 'object') return empty;
    const list = res.body.customers ?? res.body.data ?? res.body;
    const arr = Array.isArray(list) ? list : [];
    const wantFirst = (name || '').trim().toLowerCase().split(/\s+/);
    const wantLast = wantFirst.length > 1 ? wantFirst.pop() : '';
    const wantFirstStr = wantFirst.join(' ');

    const matches = [];
    let singleId = null;
    for (const c of arr) {
      const cId = c.id ?? c.customer_id;
      if (!cId) continue;
      const cFirst = (c.first_name ?? '').trim().toLowerCase();
      const cLast = (c.last_name ?? '').trim().toLowerCase();
      const cEmail = (c.email ?? '').trim().toLowerCase();
      const cPhone = normalizePhone(c.phone_number ?? c.phone ?? '');
      const nameMatch = !name || (cFirst === wantFirstStr && cLast === wantLast) || (cFirst && wantFirstStr && cFirst.startsWith(wantFirstStr)) || `${cFirst} ${cLast}`.trim() === name.toLowerCase();
      const emailMatch = !email || (cEmail && cEmail === email);
      const phoneMatch = !phone || (cPhone && cPhone.length >= 6 && cPhone.slice(-10) === phone.slice(-10));
      if (nameMatch || emailMatch || phoneMatch) {
        matches.push({
          id: String(cId),
          first_name: c.first_name ?? '',
          last_name: c.last_name ?? '',
          email: c.email ?? '',
        });
        if (singleId === null) singleId = String(cId);
      }
    }

    if (matches.length === 0) {
      return { customerId: null, matchCount: 0, matchesPreview: [], customerName: customerName || name || 'Customer' };
    }
    if (matches.length === 1) {
      const m = matches[0];
      return {
        customerId: singleId,
        matchCount: 1,
        matchesPreview: [],
        customerName: [m.first_name, m.last_name].filter(Boolean).join(' ') || customerName || 'Customer',
      };
    }
    return {
      customerId: null,
      matchCount: matches.length,
      matchesPreview: matches.slice(0, 5).map((m) => ({
        id: m.id,
        first_name: m.first_name,
        last_name: m.last_name,
        email: m.email,
      })),
      customerName: customerName || name || 'Customer',
    };
  } catch (_) {
    return empty;
  }
}

app.put('/estimator/config', requireBridgeAuth, applyRateLimit, async (req, res) => {
  const userId = extractUserId(req);
  const configPatch = req.body?.config;
  if (!userId) {
    return res.status(400).json({ error: 'Missing user_id' });
  }
  if (!configPatch || typeof configPatch !== 'object' || Array.isArray(configPatch)) {
    return res.status(400).json({ error: 'Missing config object' });
  }
  try {
    const config = await upsertEstimatorConfig(userId, configPatch);
    return res.json({ user_id: userId, config });
  } catch (err) {
    return handleEstimatorError(err, res);
  }
});

app.put('/estimator/catalog', requireBridgeAuth, applyRateLimit, async (req, res) => {
  const userId = extractUserId(req);
  const items = req.body?.items;
  if (!userId) {
    return res.status(400).json({ error: 'Missing user_id' });
  }
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Missing items array' });
  }
  try {
    const catalog = await replaceEstimatorCatalog(userId, items);
    return res.json({ user_id: userId, catalog_count: catalog.length });
  } catch (err) {
    return handleEstimatorError(err, res);
  }
});

app.get('/estimator/profile', requireBridgeAuth, async (req, res) => {
  const userId = req.query?.user_id ?? req.headers['x-user-id'];
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Missing user_id' });
  }
  try {
    const profile = await getEstimatorProfile(userId);
    return res.json({
      user_id: userId,
      config: profile.config,
      catalog_count: profile.catalog.length,
      catalog: profile.catalog,
    });
  } catch (err) {
    return handleEstimatorError(err, res);
  }
});

app.post('/estimator/changeout-plan', requireBridgeAuth, applyRateLimit, validateBody(changeoutPlanBodySchema, { userIdHeader: true }), async (req, res) => {
  const userId = extractUserId(req);
  if (!userId) {
    return res.status(400).json({ error: 'Missing user_id' });
  }
  try {
    const profile = await getEstimatorProfile(userId);
    const { runtimeProfile: planProfile, catalogRuntime: importedCatalogMeta } = await resolveRuntimeEstimatorProfile(
      profile,
      req.body,
    );

    const plan = buildChangeoutPlan({
      profile: planProfile,
      intake: req.body?.intake,
      customer: req.body?.customer,
      project: req.body?.project,
      limit: req.body?.limit,
    });
    return res.json({
      user_id: userId,
      plan,
      catalog_runtime: importedCatalogMeta,
    });
  } catch (err) {
    return handleEstimatorError(err, res);
  }
});

app.post('/estimator/estimate', requireBridgeAuth, applyRateLimit, validateBody(estimateBodySchema, { userIdHeader: true }), async (req, res) => {
  const userId = extractUserId(req);
  if (!userId) {
    return res.status(400).json({ error: 'Missing user_id' });
  }
  try {
    const profile = await getEstimatorProfile(userId);
    const { runtimeProfile, catalogRuntime } = await resolveRuntimeEstimatorProfile(profile, req.body);
    const estimate = buildEstimate({
      config: runtimeProfile.config,
      catalog: runtimeProfile.catalog,
      selections: req.body?.selections,
      manual_items: req.body?.manual_items,
      customer: req.body?.customer,
      project: req.body?.project,
      adjustments: req.body?.adjustments,
    });
    const output = req.body?.output === 'html' ? 'html' : 'json';
    const html = renderEstimateHtml(estimate);
    if (output === 'html') {
      return res.type('text/html').send(html);
    }
    return res.json({
      estimate,
      printable_html: html,
      catalog_runtime: catalogRuntime,
    });
  } catch (err) {
    return handleEstimatorError(err, res);
  }
});

app.post('/estimator/export/housecall', requireBridgeAuth, applyRateLimit, validateBody(exportHousecallBodySchema, { userIdHeader: true }), async (req, res) => {
  const userId = extractUserId(req);
  if (!userId) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  const idempotencyKey = (req.headers['idempotency-key'] || req.body?.idempotency_key || '').trim();
  if (idempotencyKey) {
    const stored = await getIdempotencyResult(userId, idempotencyKey);
    if (stored && !stored._claimed) {
      res.setHeader('X-Idempotency-Replay', 'true');
      return res.status(200).json(stored);
    }
  }

  try {
    let estimate = req.body?.estimate;
    let catalogRuntime = null;
    if (!estimate || typeof estimate !== 'object') {
      const profile = await getEstimatorProfile(userId);
      const runtime = await resolveRuntimeEstimatorProfile(profile, req.body);
      catalogRuntime = runtime.catalogRuntime;
      estimate = buildEstimate({
        config: runtime.runtimeProfile.config,
        catalog: runtime.runtimeProfile.catalog,
        selections: req.body?.selections,
        manual_items: req.body?.manual_items,
        customer: req.body?.customer,
        project: req.body?.project,
        adjustments: req.body?.adjustments,
      });
    }

    const housecallOpts = req.body?.housecall && typeof req.body.housecall === 'object' ? req.body.housecall : {};
    const directContext = {
      jobId: asTrimmedString(housecallOpts.job_id ?? housecallOpts.jobId),
      estimateId: asTrimmedString(housecallOpts.estimate_id ?? housecallOpts.estimateId),
      estimateOptionId: asTrimmedString(
        housecallOpts.estimate_option_id ?? housecallOpts.estimateOptionId,
      ),
      appointmentId: asTrimmedString(housecallOpts.appointment_id ?? housecallOpts.appointmentId),
    };
    let resolvedContext = mergeHousecallContext(directContext, {});
    let lookup = null;
    const hasLookupTemplate = Boolean(
      housecallOpts.appointment_lookup_path ||
        housecallOpts.appointmentLookupPath ||
        process.env.HOUSECALL_PRO_APPOINTMENT_LOOKUP_PATH,
    );

    const shouldLookupFromAppointment =
      !!resolvedContext.appointmentId &&
      !resolvedContext.estimateId &&
      hasLookupTemplate &&
      (housecallOpts.resolve_context === true ||
        housecallOpts.resolveContext === true ||
        housecallOpts.auto_upsert !== false ||
        housecallOpts.autoUpsert !== false);

    if (shouldLookupFromAppointment) {
      const lookupRequest = buildHousecallAppointmentLookupRequest({
        appointment_id: resolvedContext.appointmentId,
        appointment_lookup_path: housecallOpts.appointment_lookup_path ?? housecallOpts.appointmentLookupPath,
        appointment_lookup_method:
          housecallOpts.appointment_lookup_method ?? housecallOpts.appointmentLookupMethod,
        appointment_lookup_query:
          housecallOpts.appointment_lookup_query ?? housecallOpts.appointmentLookupQuery,
      });
      const lookupResponse = await mcpHousecallRequest({
        method: lookupRequest.method,
        path: lookupRequest.path,
        query: lookupRequest.query,
      });
      lookup = {
        ok: lookupResponse.ok,
        status: lookupResponse.status,
        request: lookupRequest,
        body_preview: sanitizePreview(lookupResponse.body, 1500),
      };
      if (lookupResponse.ok && lookupResponse.body && typeof lookupResponse.body === 'object') {
        const extractedContext = extractHousecallIdsFromObject(lookupResponse.body);
        resolvedContext = mergeHousecallContext(resolvedContext, extractedContext);
      }
    }

    let customerId = housecallOpts.customer_id ?? housecallOpts.customerId;
    if (!customerId && estimate?.customer) {
      const fromEstimate =
        estimate.customer.housecall_customer_id ??
        estimate.customer.housecallCustomerId ??
        estimate.customer.customer_id ??
        estimate.customer.customerId;
      if (fromEstimate) customerId = fromEstimate;
    }
    let customerResolution = null;
    if (!customerId) {
      const resolution = await resolveCustomerIdForExport(estimate);
      if (resolution.matchCount === 1 && resolution.customerId) customerId = resolution.customerId;
      customerResolution = {
        used_existing: resolution.matchCount === 1 && !!resolution.customerId,
        customer_id: resolution.customerId,
        match_count: resolution.matchCount,
        matches_preview: resolution.matchesPreview,
        customer_name: resolution.customerName,
      };
    } else if (estimate?.customer && customerId) {
      customerResolution = {
        used_existing: true,
        customer_id: customerId,
        match_count: 1,
        matches_preview: [],
        customer_name: (estimate.customer.name || [estimate.customer.first_name, estimate.customer.last_name].filter(Boolean).join(' ')).trim() || 'Customer',
      };
    }

    const notificationsEnabled = housecallOpts.notifications_enabled ?? housecallOpts.notificationsEnabled;

    const exportPlan = buildHousecallUpsertPlan(estimate, {
      endpoint: housecallOpts.endpoint,
      method: housecallOpts.method,
      mode: housecallOpts.mode,
      autoUpsert: housecallOpts.auto_upsert ?? housecallOpts.autoUpsert,
      customerId: customerId || (housecallOpts.customer_id ?? housecallOpts.customerId),
      jobId: resolvedContext.jobId,
      estimateId: resolvedContext.estimateId,
      estimateOptionId: resolvedContext.estimateOptionId,
      appointmentId: resolvedContext.appointmentId,
      optionName: housecallOpts.option_name ?? housecallOpts.optionName,
      note: housecallOpts.note,
      notificationsEnabled,
      payloadOverride: housecallOpts.payload_override ?? housecallOpts.payloadOverride,
      createEstimatePath: housecallOpts.create_estimate_path ?? housecallOpts.createEstimatePath,
      addToJobPath: housecallOpts.add_to_job_path ?? housecallOpts.addToJobPath,
      updateEstimatePath: housecallOpts.update_estimate_path ?? housecallOpts.updateEstimatePath,
      addOptionNotePath: housecallOpts.add_option_note_path ?? housecallOpts.addOptionNotePath,
    });

    if (housecallOpts.dry_run === true || housecallOpts.dryRun === true) {
      const dryRunPayload = {
        dry_run: true,
        estimate,
        catalog_runtime: catalogRuntime,
        upsert_strategy: exportPlan.strategy,
        resolved_context: exportPlan.context,
        customer_resolution: customerResolution,
        notifications_enabled: notificationsEnabled,
        lookup,
        housecall_plan: exportPlan.requests.map((requestPayload) => ({
          mode: requestPayload.mode,
          method: requestPayload.method,
          path: requestPayload.path,
          path_template: requestPayload.path_template,
          payload: requestPayload.payload,
        })),
      };
      if (idempotencyKey) await setIdempotencyResult(userId, idempotencyKey, dryRunPayload);
      return res.json(dryRunPayload);
    }

    const attempts = [];
    let selectedRequest = null;
    let selectedResponse = null;

    for (let index = 0; index < exportPlan.requests.length; index += 1) {
      const requestPayload = exportPlan.requests[index];
      const upstream = await mcpHousecallRequest({
        method: requestPayload.method,
        path: requestPayload.path,
        body: requestPayload.payload,
      });

      attempts.push({
        mode: requestPayload.mode,
        method: requestPayload.method,
        path: requestPayload.path,
        path_template: requestPayload.path_template,
        ok: upstream.ok,
        status: upstream.status,
        statusText: upstream.statusText,
        response_preview: sanitizePreview(upstream.body, 1000),
      });

      if (upstream.ok) {
        selectedRequest = requestPayload;
        selectedResponse = upstream;
        break;
      }

      const hasRemainingAttempts = index < exportPlan.requests.length - 1;
      if (!hasRemainingAttempts) {
        selectedRequest = requestPayload;
        selectedResponse = upstream;
        break;
      }
      if (exportPlan.strategy !== 'auto_upsert') {
        selectedRequest = requestPayload;
        selectedResponse = upstream;
        break;
      }
      if (!isHousecallNotFound(upstream)) {
        selectedRequest = requestPayload;
        selectedResponse = upstream;
        break;
      }
    }

    const success = Boolean(selectedResponse?.ok);

    const exportPayload = {
      estimate,
      catalog_runtime: catalogRuntime,
      upsert_strategy: exportPlan.strategy,
      resolved_context: exportPlan.context,
      customer_resolution: customerResolution,
      notifications_enabled: notificationsEnabled,
      lookup,
      attempts,
      housecall_request: selectedRequest
        ? {
            mode: selectedRequest.mode,
            method: selectedRequest.method,
            path: selectedRequest.path,
            path_template: selectedRequest.path_template,
            payload_preview: sanitizePreview(selectedRequest.payload, 2000),
          }
        : null,
      housecall_response: selectedResponse
        ? {
            ok: selectedResponse.ok,
            status: selectedResponse.status,
            statusText: selectedResponse.statusText,
            body: selectedResponse.body,
          }
        : null,
    };
    if (success && idempotencyKey) await setIdempotencyResult(userId, idempotencyKey, exportPayload);
    return res.status(success ? 200 : 502).json(exportPayload);
  } catch (err) {
    return handleEstimatorError(err, res);
  }
});

app.post('/chat', requireBridgeAuth, applyRateLimit, validateBody(chatBodySchema), async (req, res) => {
  const userId = req.body.user_id ?? req.headers['x-user-id'];
  const message = req.body.message ?? req.body.text ?? '';
  const asyncMode = req.query.async === 'true' || req.body.async === true;

  if (asyncMode) {
    const jobId = await createJob({ user_id: userId });
    const statusUrl = `${baseUrl}/jobs/${jobId}`;

    setImmediate(async () => {
      try {
        await updateJob(jobId, { status: 'running' });
        const { agentId } = await sendToAgent(userId, message);
        await updateJob(jobId, { agent_id: agentId });
        const { state, lastContent } = await waitForCompletion(agentId);
        if (state === 'completed' || state === 'failed' || state === 'stopped') {
          const orchestrator = await dispatchOrchestratorCommands(lastContent, { userId });
          await updateJob(jobId, {
            status: state === 'completed' ? 'completed' : 'failed',
            result: {
              reply: lastContent,
              agent_id: agentId,
              state,
              parsed: orchestrator.parsed,
              dispatched: orchestrator.dispatched,
            },
            error: state !== 'completed' ? (lastContent || 'Agent stopped') : null,
          });
        } else {
          await updateJob(jobId, {
            status: 'completed',
            result: {
              reply: lastContent || 'Agent still running.',
              agent_id: agentId,
              state,
            },
          });
        }
      } catch (err) {
        console.error('[chat async job]', jobId, err);
        await updateJob(jobId, { status: 'failed', error: err.message });
      }
    });

    return res.status(202).json({
      job_id: jobId,
      agent_id: null,
      status: 'pending',
      status_url: statusUrl,
    });
  }

  try {
    const { agentId } = await sendToAgent(userId, message);
    const { state, lastContent } = await waitForCompletion(agentId);
    if (state === 'completed' || state === 'failed' || state === 'stopped') {
      const orchestrator = await dispatchOrchestratorCommands(lastContent, { userId });
      req.agentId = agentId;
      return res.json({
        reply: lastContent,
        agent_id: agentId,
        state,
        parsed: orchestrator.parsed,
        dispatched: orchestrator.dispatched,
      });
    }
    req.agentId = agentId;
    res.json({ reply: lastContent || 'Agent still running.', agent_id: agentId, state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/agent/:userId', requireBridgeAuth, async (req, res) => {
  const id = await getAgentId(req.params.userId);
  res.json({ agent_id: id });
});

app.get('/jobs/:id', requireBridgeAuth, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const statusUrl = `${baseUrl}/jobs/${job.id}`;
  return res.json({
    job_id: job.id,
    agent_id: job.agent_id,
    user_id: job.user_id,
    status: job.status,
    result: job.result,
    error: job.error,
    created_at: job.created_at,
    status_url: statusUrl,
  });
});

app.get('/debug/agent/:agentId', requireBridgeAuth, async (req, res) => {
  const { agentId } = req.params;
  try {
    const [agent, conv] = await Promise.all([
      cursor.getAgent(apiKey, agentId),
      cursor.getAgentConversation(apiKey, agentId),
    ]);
    res.json({ agent, conversation: conv });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ----- HVAC catalog ingest -----

function mergeCatalogs(primary = [], secondary = []) {
  const merged = new Map();
  for (const item of Array.isArray(primary) ? primary : []) {
    if (!item?.sku) continue;
    merged.set(item.sku, item);
  }
  for (const item of Array.isArray(secondary) ? secondary : []) {
    if (!item?.sku) continue;
    merged.set(item.sku, item);
  }
  return Array.from(merged.values());
}

function shouldRefreshImportedCatalog(report, profileName) {
  if (!report || typeof report !== 'object') return true;
  if ((report.profile || '') !== profileName) return true;
  if (Array.isArray(report.errors) && report.errors.length > 0) return true;
  if (!Array.isArray(report.filesProcessed) || report.filesProcessed.length === 0) return true;
  return false;
}

function runIngestScript(options = {}) {
  const args = ['imports/ingest.js'];
  if (options.only) args.push('--only', `${options.only}`);
  if (options.profile) args.push('--profile', `${options.profile}`);
  if (options.profilePath) args.push('--profile-path', `${options.profilePath}`);

  return new Promise((resolve) => {
    const child = spawn('node', args, { cwd: __dirnameBridge, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => {
      resolve({
        code: Number.isFinite(code) ? code : 1,
        stdout: out.trim(),
        stderr: err.trim(),
      });
    });
  });
}

async function resolveRuntimeEstimatorProfile(baseProfile, rawBody) {
  const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
  const catalogProfile = asTrimmedString(body.catalog_profile) || 'preferred';
  const useImportedCatalog = body.use_imported_catalog !== false;
  const includeUserCatalog = body.include_user_catalog !== false;
  const refreshImportCatalog = body.refresh_import_catalog !== false;

  if (!useImportedCatalog) {
    return {
      runtimeProfile: baseProfile,
      catalogRuntime: {
        enabled: false,
        profile: null,
        imported_catalog_count: 0,
        effective_catalog_count: Array.isArray(baseProfile?.catalog) ? baseProfile.catalog.length : 0,
      },
    };
  }

  let refreshResult = null;
  const reportBefore = catalogGetIngestReport();
  if (refreshImportCatalog && shouldRefreshImportedCatalog(reportBefore, catalogProfile)) {
    refreshResult = await runIngestScript({ profile: catalogProfile });
  }

  const importedCatalog = catalogLoadCatalog(catalogProfile);
  const mergedCatalog = importedCatalog.length
    ? includeUserCatalog
      ? mergeCatalogs(importedCatalog, baseProfile.catalog)
      : importedCatalog
    : baseProfile.catalog;

  const runtimeProfile = {
    ...baseProfile,
    catalog: mergedCatalog,
  };
  const reportAfter = catalogGetIngestReport();

  return {
    runtimeProfile,
    catalogRuntime: {
      enabled: true,
      profile: catalogProfile,
      imported_catalog_count: importedCatalog.length,
      effective_catalog_count: runtimeProfile.catalog.length,
      include_user_catalog: includeUserCatalog,
      refreshed: Boolean(refreshResult),
      refresh_ok: refreshResult ? refreshResult.code === 0 : true,
      refresh_exit_code: refreshResult ? refreshResult.code : 0,
      refresh_stderr: refreshResult?.stderr || undefined,
      report_profile: reportAfter?.profile || reportBefore?.profile || undefined,
      fallback_to_user_catalog: importedCatalog.length === 0,
    },
  };
}

app.post('/ingest', requireBridgeAuth, async (req, res) => {
  const only = req.body?.only ?? req.query?.only;
  const profile = req.body?.profile ?? req.query?.profile;
  const profilePath = req.body?.profile_path ?? req.query?.profile_path;
  const ingestResult = await runIngestScript({ only, profile, profilePath });
  const reportPath = join(__dirnameBridge, 'imports', 'validation-report.json');
  let report = null;
  if (existsSync(reportPath)) {
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (_) {
      report = { error: 'Failed to read report', stderr: ingestResult.stderr };
    }
  } else {
    report = {
      error: 'Ingest did not produce report',
      stdout: ingestResult.stdout,
      stderr: ingestResult.stderr,
    };
  }

  return res.status(ingestResult.code === 0 ? 200 : 422).json({
    ok: ingestResult.code === 0,
    exitCode: ingestResult.code,
    report,
    stdout: ingestResult.stdout,
    stderr: ingestResult.stderr || undefined,
  });
});

// ----- Telegram -----

if (telegramToken) {
  const bot = new TelegramBot(telegramToken, { polling: true });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = `telegram:${chatId}`;
    const text = msg.text?.trim();
    if (!text) return;

    try {
      console.log('[Telegram] Incoming:', userId, text.slice(0, 80));
      await bot.sendMessage(chatId, 'Sending to agent...');
      const { agentId } = await sendToAgent(userId, text);
      console.log('[Telegram] Agent id:', agentId, '- waiting for completion');
      const { state, lastContent } = await waitForCompletion(agentId);
      console.log('[Telegram] Done waiting. state=%s lastContentLength=%d', state, lastContent?.length ?? 0);
      if (state === 'completed' || state === 'failed' || state === 'stopped') {
        const orchestrator = await dispatchOrchestratorCommands(lastContent, { telegramChatId: chatId });
        let reply =
          lastContent?.slice(0, 4000) ||
          "Reply received (could not extract text — check bridge logs for conversation shape).";
        if (orchestrator.dispatched.housecallExports?.length) {
          const blockLines = formatHousecallExportBlockForTelegram(orchestrator.dispatched.housecallExports);
          reply = reply + '\n\n' + blockLines.join('\n');
        }
        const formatted = formatReplyForTelegram(reply);
        await bot.sendMessage(chatId, formatted.text, formatted.parse_mode ? { parse_mode: formatted.parse_mode } : {}).catch((err) => {
          if (formatted.parse_mode && err.message && (err.message.includes('parse') || err.message.includes('HTML'))) {
            return bot.sendMessage(chatId, reply.slice(0, 4090));
          }
          throw err;
        });
        console.log('[Telegram] Reply sent to', chatId);
        return;
      }
      const partialOrStatus = lastContent?.slice(0, 4000) || 'Agent still running.';
      const formattedPartial = formatReplyForTelegram(partialOrStatus);
      await bot.sendMessage(chatId, formattedPartial.text, formattedPartial.parse_mode ? { parse_mode: formattedPartial.parse_mode } : {}).catch((err) => {
        if (formattedPartial.parse_mode && err.message && (err.message.includes('parse') || err.message.includes('HTML'))) {
          return bot.sendMessage(chatId, partialOrStatus.slice(0, 4090));
        }
        throw err;
      });
      console.log('[Telegram] Sent', lastContent ? 'partial reply' : '"Agent still running"', 'to', chatId);
    } catch (err) {
      console.error('[Telegram] Error:', err);
      await bot.sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
    }
  });

  console.log('Telegram bot polling enabled');
} else {
  console.log('TELEGRAM_BOT_TOKEN not set; Telegram disabled');
}

const isServerEntry =
  process.argv[1] &&
  pathToFileURL(resolve(process.cwd(), process.argv[1])).href === import.meta.url;
if (isServerEntry) {
  app.listen(PORT, () => {
    console.log(
      `Bridge listening on port ${PORT}. AGENT_ENV_REPO=${agentEnvRepo} ` +
        `SUBAGENT_REPOS=${subagentRepoAllowlist.length} LOCAL_ACTIONS=${localActionAllowlist.length}`,
    );
  });
}

export { app };
