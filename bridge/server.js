/**
 * Bridge: Telegram + HTTP (PWA) -> Cursor Cloud Agents API.
 * Run with: doppler run -- node server.js
 * Env: CURSOR_API_KEY, TELEGRAM_BOT_TOKEN, AGENT_ENV_REPO (GitHub URL for agent-env repo)
 */

import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import * as cursor from './cursor-api.js';
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
