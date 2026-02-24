/**
 * Cursor Cloud Agents API client.
 * Uses Basic Auth with CURSOR_API_KEY. Base URL: https://api.cursor.com
 */

const CURSOR_API_BASE = process.env.CURSOR_API_BASE || 'https://api.cursor.com';

function getAuthHeader(apiKey) {
  const encoded = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

async function request(apiKey, method, path, body = null) {
  const url = `${CURSOR_API_BASE}${path}`;
  const headers = {
    Authorization: getAuthHeader(apiKey),
    'Content-Type': 'application/json',
  };
  const options = { method, headers };
  if (body && (method === 'POST' || method === 'PUT')) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || 60;
    throw new Error(`RATE_LIMITED:${retryAfter}`);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    // leave data null
  }
  if (!res.ok) throw new Error(data?.message || res.statusText || `HTTP ${res.status}`);
  return data;
}

/**
 * Launch a new Cloud Agent on a repository.
 * @param {string} apiKey - CURSOR_API_KEY
 * @param {object} opts - { repository, promptText, ref?, branchName?, autoCreatePr?, webhook? }
 */
export async function launchAgent(apiKey, opts) {
  const { repository, promptText, ref, branchName, autoCreatePr, webhook } = opts;
  const body = {
    prompt: { text: promptText },
    source: { repository, ...(ref && { ref }) },
    ...(branchName !== undefined && { target: { branchName, autoCreatePr: !!autoCreatePr } }),
    ...(webhook && { webhook: { url: webhook.url, ...(webhook.secret && { secret: webhook.secret }) } }),
  };
  return request(apiKey, 'POST', '/v0/agents', body);
}

/**
 * Send a follow-up to an existing agent.
 */
export async function addFollowup(apiKey, agentId, promptText) {
  return request(apiKey, 'POST', `/v0/agents/${agentId}/followup`, {
    prompt: { text: promptText },
  });
}

/**
 * Get agent status.
 */
export async function getAgent(apiKey, agentId) {
  return request(apiKey, 'GET', `/v0/agents/${agentId}`);
}

/**
 * Get full conversation history for an agent.
 */
export async function getAgentConversation(apiKey, agentId) {
  return request(apiKey, 'GET', `/v0/agents/${agentId}/conversation`);
}

/**
 * Poll until agent is no longer running (or timeout). Returns final status.
 */
export async function waitForAgent(apiKey, agentId, options = {}) {
  const { pollIntervalMs = 15000, maxWaitMs = 600000 } = options;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const agent = await getAgent(apiKey, agentId);
    const status = agent.status?.state ?? agent.state;
    if (status === 'completed' || status === 'failed' || status === 'stopped') return agent;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error('Timeout waiting for agent');
}
