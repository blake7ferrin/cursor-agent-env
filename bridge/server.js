/**
 * Bridge: Telegram + HTTP (PWA) -> Cursor Cloud Agents API.
 * Run with: doppler run -- node server.js
 * Env: CURSOR_API_KEY, TELEGRAM_BOT_TOKEN, AGENT_ENV_REPO (GitHub URL for agent-env repo)
 */

import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import * as cursor from './cursor-api.js';
import { buildEstimate, renderEstimateHtml } from './estimator-engine.js';
import { EstimatorValidationError } from './estimator-domain.js';
import {
  buildHousecallAppointmentLookupRequest,
  buildHousecallExportRequest,
  extractHousecallIdsFromObject,
} from './housecall-mapper.js';
import { getHousecallConfigSummary, housecallRequest, testHousecallConnection } from './housecall-pro.js';
import {
  getEstimatorProfile,
  replaceEstimatorCatalog,
  upsertEstimatorConfig,
} from './estimator-store.js';
import { createDispatcher } from './orchestrator-dispatch.js';
import { createRateLimiter } from './rate-limiter.js';
import { getAgentId, setAgentId, clearAgentId } from './store.js';

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
    const content = m.content ?? m.text ?? m.parts?.map((p) => p.text).join('') ?? '';
    if (role === 'assistant' && content) return content;
  }
  return '';
}

async function waitForCompletion(agentId, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 15000;
  const maxWaitMs = options.maxWaitMs ?? 300000;
  const start = Date.now();
  let lastContent = '';
  let state = 'running';

  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const agent = await cursor.getAgent(apiKey, agentId);
    state = agent.status?.state ?? agent.state ?? 'running';
    lastContent = await getLatestAssistantMessage(agentId);
    if (state === 'completed' || state === 'failed' || state === 'stopped') {
      return { state, lastContent };
    }
  }

  return { state: 'running', lastContent };
}

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
});

// ----- HTTP (PWA) -----

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/integrations/housecall/config', requireBridgeAuth, (req, res) => {
  res.json({ housecall: getHousecallConfigSummary() });
});

app.post('/integrations/housecall/test', requireBridgeAuth, applyRateLimit, async (req, res) => {
  try {
    const path = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const result = await testHousecallConnection(path || undefined);
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

app.post('/integrations/housecall/request', requireBridgeAuth, applyRateLimit, async (req, res) => {
  const method = `${req.body?.method || 'GET'}`.toUpperCase();
  const path = req.body?.path;
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'Missing path' });
  }
  if (!/^\/v\d+\//.test(path) && !path.startsWith('https://') && !path.startsWith('http://')) {
    return res.status(400).json({ error: 'path must start with /v<version>/ or be an absolute URL' });
  }
  try {
    const result = await housecallRequest({
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
    const lookupRequest = buildHousecallAppointmentLookupRequest({
      appointment_id: req.body?.appointment_id ?? req.body?.appointmentId,
      appointment_lookup_path: req.body?.appointment_lookup_path ?? req.body?.appointmentLookupPath,
      appointment_lookup_method: req.body?.appointment_lookup_method ?? req.body?.appointmentLookupMethod,
      appointment_lookup_query: req.body?.appointment_lookup_query ?? req.body?.appointmentLookupQuery,
    });
    const lookupResponse = await housecallRequest({
      method: lookupRequest.method,
      path: lookupRequest.path,
      query: lookupRequest.query,
    });
    const extracted = extractHousecallIdsFromObject(lookupResponse.body);
    return res.status(lookupResponse.ok ? 200 : 502).json({
      ok: lookupResponse.ok,
      status: lookupResponse.status,
      lookup_request: lookupRequest,
      extracted_context: extracted,
      raw_body: lookupResponse.body,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Housecall context resolution failed' });
  }
});

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

app.post('/estimator/estimate', requireBridgeAuth, applyRateLimit, async (req, res) => {
  const userId = extractUserId(req);
  if (!userId) {
    return res.status(400).json({ error: 'Missing user_id' });
  }
  try {
    const profile = await getEstimatorProfile(userId);
    const estimate = buildEstimate({
      config: profile.config,
      catalog: profile.catalog,
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
    });
  } catch (err) {
    return handleEstimatorError(err, res);
  }
});

app.post('/estimator/export/housecall', requireBridgeAuth, applyRateLimit, async (req, res) => {
  const userId = extractUserId(req);
  if (!userId) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  try {
    let estimate = req.body?.estimate;
    if (!estimate || typeof estimate !== 'object') {
      const profile = await getEstimatorProfile(userId);
      estimate = buildEstimate({
        config: profile.config,
        catalog: profile.catalog,
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

    const shouldLookupFromAppointment =
      !!resolvedContext.appointmentId &&
      !resolvedContext.jobId &&
      !resolvedContext.estimateId &&
      (housecallOpts.resolve_context === true ||
        housecallOpts.resolveContext === true ||
        housecallOpts.appointment_lookup_path ||
        housecallOpts.appointmentLookupPath ||
        process.env.HOUSECALL_PRO_APPOINTMENT_LOOKUP_PATH);

    if (shouldLookupFromAppointment) {
      const lookupRequest = buildHousecallAppointmentLookupRequest({
        appointment_id: resolvedContext.appointmentId,
        appointment_lookup_path: housecallOpts.appointment_lookup_path ?? housecallOpts.appointmentLookupPath,
        appointment_lookup_method:
          housecallOpts.appointment_lookup_method ?? housecallOpts.appointmentLookupMethod,
        appointment_lookup_query:
          housecallOpts.appointment_lookup_query ?? housecallOpts.appointmentLookupQuery,
      });
      const lookupResponse = await housecallRequest({
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

    const requestPayload = buildHousecallExportRequest(estimate, {
      endpoint: housecallOpts.endpoint,
      method: housecallOpts.method,
      mode: housecallOpts.mode,
      customerId: housecallOpts.customer_id ?? housecallOpts.customerId,
      jobId: resolvedContext.jobId,
      estimateId: resolvedContext.estimateId,
      estimateOptionId: resolvedContext.estimateOptionId,
      appointmentId: resolvedContext.appointmentId,
      optionName: housecallOpts.option_name ?? housecallOpts.optionName,
      note: housecallOpts.note,
      payloadOverride: housecallOpts.payload_override ?? housecallOpts.payloadOverride,
      createEstimatePath: housecallOpts.create_estimate_path ?? housecallOpts.createEstimatePath,
      addToJobPath: housecallOpts.add_to_job_path ?? housecallOpts.addToJobPath,
      updateEstimatePath: housecallOpts.update_estimate_path ?? housecallOpts.updateEstimatePath,
      addOptionNotePath: housecallOpts.add_option_note_path ?? housecallOpts.addOptionNotePath,
    });

    if (housecallOpts.dry_run === true || housecallOpts.dryRun === true) {
      return res.json({
        dry_run: true,
        estimate,
        resolved_context: requestPayload.context,
        lookup,
        housecall_request: {
          mode: requestPayload.mode,
          method: requestPayload.method,
          path: requestPayload.path,
          path_template: requestPayload.path_template,
          payload: requestPayload.payload,
        },
      });
    }

    const upstream = await housecallRequest({
      method: requestPayload.method,
      path: requestPayload.path,
      body: requestPayload.payload,
    });

    return res.status(upstream.ok ? 200 : 502).json({
      estimate,
      resolved_context: requestPayload.context,
      lookup,
      housecall_request: {
        mode: requestPayload.mode,
        method: requestPayload.method,
        path: requestPayload.path,
        path_template: requestPayload.path_template,
        payload_preview: sanitizePreview(requestPayload.payload, 2000),
      },
      housecall_response: {
        ok: upstream.ok,
        status: upstream.status,
        statusText: upstream.statusText,
        body: upstream.body,
      },
    });
  } catch (err) {
    return handleEstimatorError(err, res);
  }
});

app.post('/chat', requireBridgeAuth, applyRateLimit, async (req, res) => {
  const userId = req.body.user_id ?? req.headers['x-user-id'];
  const message = req.body.message ?? req.body.text;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Missing user_id' });
  }
  if (!message) {
    return res.status(400).json({ error: 'Missing message' });
  }
  try {
    const { agentId } = await sendToAgent(userId, message);
    const { state, lastContent } = await waitForCompletion(agentId);
    if (state === 'completed' || state === 'failed' || state === 'stopped') {
      const orchestrator = await dispatchOrchestratorCommands(lastContent);
      return res.json({
        reply: lastContent,
        agent_id: agentId,
        state,
        parsed: orchestrator.parsed,
        dispatched: orchestrator.dispatched,
      });
    }
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

// ----- Telegram -----

if (telegramToken) {
  const bot = new TelegramBot(telegramToken, { polling: true });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = `telegram:${chatId}`;
    const text = msg.text?.trim();
    if (!text) return;

    try {
      await bot.sendMessage(chatId, 'Sending to agent...');
      const { agentId } = await sendToAgent(userId, text);
      const { state, lastContent } = await waitForCompletion(agentId);
      if (state === 'completed' || state === 'failed' || state === 'stopped') {
        await dispatchOrchestratorCommands(lastContent);
        const reply = lastContent?.slice(0, 4000) || 'Done.';
        await bot.sendMessage(chatId, reply);
        return;
      }
      await bot.sendMessage(chatId, lastContent?.slice(0, 4000) || 'Agent still running.');
    } catch (err) {
      console.error(err);
      await bot.sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
    }
  });

  console.log('Telegram bot polling enabled');
} else {
  console.log('TELEGRAM_BOT_TOKEN not set; Telegram disabled');
}

app.listen(PORT, () => {
  console.log(
    `Bridge listening on port ${PORT}. AGENT_ENV_REPO=${agentEnvRepo} ` +
      `SUBAGENT_REPOS=${subagentRepoAllowlist.length} LOCAL_ACTIONS=${localActionAllowlist.length}`,
  );
});
