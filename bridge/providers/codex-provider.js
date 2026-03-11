import { randomUUID } from 'node:crypto';

const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com';
const DEFAULT_FULL_MODEL = process.env.OPENAI_MODEL || process.env.OPENAI_MODEL_FULL || 'gpt-5';
const DEFAULT_MINI_MODEL = process.env.OPENAI_MODEL_MINI || 'gpt-5-mini';
const DEFAULT_ROUTING_MODE = (process.env.OPENAI_MODEL_ROUTING || 'auto').trim().toLowerCase();

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function buildErrorMessage(status, data, fallbackStatusText) {
  const apiMessage =
    data?.error?.message ||
    data?.message ||
    fallbackStatusText ||
    `HTTP ${status}`;
  return `${apiMessage}`.trim();
}

function extractAssistantText(responseData) {
  if (typeof responseData?.output_text === 'string' && responseData.output_text.trim()) {
    return responseData.output_text.trim();
  }

  const outputItems = Array.isArray(responseData?.output) ? responseData.output : [];
  const textParts = [];
  for (const item of outputItems) {
    const role = item?.role;
    if (role && role !== 'assistant') continue;
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        textParts.push(part.text.trim());
      }
      if (typeof part?.content === 'string' && part.content.trim()) {
        textParts.push(part.content.trim());
      }
    }
  }
  return textParts.join('\n').trim();
}

async function requestResponses(apiKey, payload) {
  const url = `${OPENAI_API_BASE}/v1/responses`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || 60;
    throw new Error(`RATE_LIMITED:${retryAfter}`);
  }
  if (!res.ok) {
    throw new Error(buildErrorMessage(res.status, data, res.statusText));
  }

  return data;
}

function createAgentRecord({ agentId, responseData, userPrompt, assistantText }) {
  return {
    id: agentId,
    state: 'completed',
    response_id: responseData?.id || null,
    status: responseData?.status || 'completed',
    last_error: null,
    conversation: [
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: assistantText },
    ],
    updated_at: Date.now(),
  };
}

function appendTurn(record, userPrompt, assistantText, responseData) {
  const nextConversation = Array.isArray(record.conversation) ? [...record.conversation] : [];
  nextConversation.push({ role: 'user', content: userPrompt });
  nextConversation.push({ role: 'assistant', content: assistantText });
  return {
    ...record,
    state: 'completed',
    status: responseData?.status || 'completed',
    response_id: responseData?.id || record.response_id || null,
    last_error: null,
    conversation: nextConversation,
    updated_at: Date.now(),
  };
}

function resolveRoutingMode(rawValue) {
  const mode = `${rawValue || 'auto'}`.trim().toLowerCase();
  if (mode === 'mini' || mode === 'full' || mode === 'auto') return mode;
  return 'auto';
}

function isComplexEngineeringPrompt(prompt = '') {
  const text = `${prompt}`.trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  const lineCount = text.split(/\r?\n/).length;
  if (text.length >= 1800 || lineCount >= 30) return true;

  const complexPatterns = [
    /multi[-\s]?file/,
    /across files/,
    /refactor/,
    /architecture/,
    /migrat(e|ion)/,
    /root cause/,
    /production issue/,
    /performance/,
    /security/,
    /design doc/,
    /deep debug/,
    /complex/,
    /\bci\b/,
    /pipeline/,
  ];
  return complexPatterns.some((pattern) => pattern.test(lower));
}

function selectModel({ promptText, routingMode, modelMini, modelFull }) {
  if (routingMode === 'mini') return { model: modelMini, route: 'forced_mini' };
  if (routingMode === 'full') return { model: modelFull, route: 'forced_full' };
  if (isComplexEngineeringPrompt(promptText)) return { model: modelFull, route: 'auto_full_complex' };
  return { model: modelMini, route: 'auto_mini_default' };
}

export function createCodexProvider(options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  const modelFull = options.model || options.modelFull || DEFAULT_FULL_MODEL;
  const modelMini = options.modelMini || DEFAULT_MINI_MODEL;
  const routingMode = resolveRoutingMode(options.routingMode || DEFAULT_ROUTING_MODE);
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY. Set OPENAI_API_KEY or choose AGENT_PROVIDER=cursor.');
  }

  const agentStore = new Map();

  return {
    name: 'codex',

    async launchAgent(params = {}) {
      const userPrompt = `${params.promptText || ''}`.trim();
      const modelSelection = selectModel({
        promptText: userPrompt,
        routingMode,
        modelMini,
        modelFull,
      });
      const responseData = await requestResponses(apiKey, {
        model: modelSelection.model,
        input: userPrompt,
      });
      const assistantText = extractAssistantText(responseData);
      const agentId = randomUUID();
      const record = createAgentRecord({ agentId, responseData, userPrompt, assistantText });
      record.model = modelSelection.model;
      record.route = modelSelection.route;
      agentStore.set(agentId, record);
      return {
        id: agentId,
        agent_id: agentId,
        state: record.state,
        status: { state: record.state },
        provider: 'codex',
        model: record.model,
        route: record.route,
      };
    },

    async addFollowup(agentId, promptText) {
      const record = agentStore.get(agentId);
      if (!record) throw new Error('agent not found');
      const userPrompt = `${promptText || ''}`.trim();
      const responseData = await requestResponses(apiKey, {
        model: record.model || modelMini,
        input: userPrompt,
        ...(record.response_id && { previous_response_id: record.response_id }),
      });
      const assistantText = extractAssistantText(responseData);
      const updated = appendTurn(record, userPrompt, assistantText, responseData);
      agentStore.set(agentId, updated);
      return {
        id: agentId,
        agent_id: agentId,
        state: updated.state,
        status: { state: updated.state },
        provider: 'codex',
        model: updated.model || record.model || modelMini,
        route: updated.route || record.route || 'followup_same_model',
      };
    },

    async getAgent(agentId) {
      const record = agentStore.get(agentId);
      if (!record) throw new Error('agent not found');
      return {
        id: record.id,
        state: record.state,
        status: { state: record.state },
        provider: 'codex',
        model: record.model || modelMini,
        route: record.route || 'unknown',
      };
    },

    async getAgentConversation(agentId) {
      const record = agentStore.get(agentId);
      if (!record) throw new Error('agent not found');
      return {
        messages: record.conversation,
      };
    },

    async waitForAgent(agentId) {
      const agent = await this.getAgent(agentId);
      return agent;
    },
  };
}
