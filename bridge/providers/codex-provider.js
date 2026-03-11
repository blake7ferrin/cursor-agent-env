import { randomUUID } from 'node:crypto';
import {
  getCodexSession,
  setCodexSession,
} from '../codex-session-store.js';
import {
  recordCodexUsage,
  getCodexMonthlyCostUsd,
} from '../codex-usage-store.js';

const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com';
const DEFAULT_FULL_MODEL = process.env.OPENAI_MODEL || process.env.OPENAI_MODEL_FULL || 'gpt-5';
const DEFAULT_MINI_MODEL = process.env.OPENAI_MODEL_MINI || 'gpt-5-mini';
const DEFAULT_ROUTING_MODE = (process.env.OPENAI_MODEL_ROUTING || 'auto').trim().toLowerCase();
const DEFAULT_BUDGET_MONTHLY_USD = Number.parseFloat(process.env.OPENAI_BUDGET_MONTHLY_USD || '0');
const DEFAULT_BUDGET_FORCE_MINI_THRESHOLD_PCT = Number.parseFloat(
  process.env.OPENAI_BUDGET_FORCE_MINI_THRESHOLD_PCT || '1.0',
);
const DEFAULT_PRICE_INPUT_FULL_PER_1M = Number.parseFloat(
  process.env.OPENAI_PRICE_INPUT_FULL_PER_1M || '2.5',
);
const DEFAULT_PRICE_OUTPUT_FULL_PER_1M = Number.parseFloat(
  process.env.OPENAI_PRICE_OUTPUT_FULL_PER_1M || '15',
);
const DEFAULT_PRICE_INPUT_MINI_PER_1M = Number.parseFloat(
  process.env.OPENAI_PRICE_INPUT_MINI_PER_1M || '0.25',
);
const DEFAULT_PRICE_OUTPUT_MINI_PER_1M = Number.parseFloat(
  process.env.OPENAI_PRICE_OUTPUT_MINI_PER_1M || '2',
);

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

function parseTokenCount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function extractUsageMetrics(responseData) {
  const usage = responseData?.usage || {};
  const inputTokens = parseTokenCount(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens,
  );
  const outputTokens = parseTokenCount(
    usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens,
  );
  const totalTokens = parseTokenCount(usage.total_tokens ?? usage.totalTokens) || (inputTokens + outputTokens);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function getModelTier(model) {
  const normalized = `${model || ''}`.toLowerCase();
  return normalized.includes('mini') ? 'mini' : 'full';
}

function computeUsageCostUsd(usage, model, pricing) {
  const tier = getModelTier(model);
  const inputRate = tier === 'mini' ? pricing.inputMiniPer1m : pricing.inputFullPer1m;
  const outputRate = tier === 'mini' ? pricing.outputMiniPer1m : pricing.outputFullPer1m;
  const inputCost = (usage.input_tokens / 1_000_000) * inputRate;
  const outputCost = (usage.output_tokens / 1_000_000) * outputRate;
  return Math.round((inputCost + outputCost + Number.EPSILON) * 1e6) / 1e6;
}

async function maybeApplyBudgetGuard({
  selectedModel,
  selectedRoute,
  modelMini,
  routingMode,
  budgetMonthlyUsd,
  budgetForceMiniThresholdPct,
  usageStore,
}) {
  if (routingMode !== 'auto') return { model: selectedModel, route: selectedRoute };
  if (!Number.isFinite(budgetMonthlyUsd) || budgetMonthlyUsd <= 0) {
    return { model: selectedModel, route: selectedRoute };
  }
  const threshold = Number.isFinite(budgetForceMiniThresholdPct) && budgetForceMiniThresholdPct > 0
    ? budgetForceMiniThresholdPct
    : 1;
  const monthlyCost = await usageStore.getMonthlyCostUsd();
  if (monthlyCost >= budgetMonthlyUsd * threshold) {
    return { model: modelMini, route: 'budget_force_mini' };
  }
  return { model: selectedModel, route: selectedRoute };
}

export function createCodexProvider(options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  const modelFull = options.model || options.modelFull || DEFAULT_FULL_MODEL;
  const modelMini = options.modelMini || DEFAULT_MINI_MODEL;
  const routingMode = resolveRoutingMode(options.routingMode || DEFAULT_ROUTING_MODE);
  const budgetMonthlyUsd = Number.isFinite(options.budgetMonthlyUsd)
    ? Number(options.budgetMonthlyUsd)
    : DEFAULT_BUDGET_MONTHLY_USD;
  const budgetForceMiniThresholdPct = Number.isFinite(options.budgetForceMiniThresholdPct)
    ? Number(options.budgetForceMiniThresholdPct)
    : DEFAULT_BUDGET_FORCE_MINI_THRESHOLD_PCT;
  const pricing = {
    inputFullPer1m: Number.isFinite(options.inputFullPer1m)
      ? Number(options.inputFullPer1m)
      : DEFAULT_PRICE_INPUT_FULL_PER_1M,
    outputFullPer1m: Number.isFinite(options.outputFullPer1m)
      ? Number(options.outputFullPer1m)
      : DEFAULT_PRICE_OUTPUT_FULL_PER_1M,
    inputMiniPer1m: Number.isFinite(options.inputMiniPer1m)
      ? Number(options.inputMiniPer1m)
      : DEFAULT_PRICE_INPUT_MINI_PER_1M,
    outputMiniPer1m: Number.isFinite(options.outputMiniPer1m)
      ? Number(options.outputMiniPer1m)
      : DEFAULT_PRICE_OUTPUT_MINI_PER_1M,
  };
  const usageStore = {
    recordUsage: options.recordUsage || recordCodexUsage,
    getMonthlyCostUsd: options.getMonthlyCostUsd || getCodexMonthlyCostUsd,
  };
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY. Set OPENAI_API_KEY or choose AGENT_PROVIDER=cursor.');
  }

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
      const budgetedSelection = await maybeApplyBudgetGuard({
        selectedModel: modelSelection.model,
        selectedRoute: modelSelection.route,
        modelMini,
        routingMode,
        budgetMonthlyUsd,
        budgetForceMiniThresholdPct,
        usageStore,
      });
      const responseData = await requestResponses(apiKey, {
        model: budgetedSelection.model,
        input: userPrompt,
      });
      const assistantText = extractAssistantText(responseData);
      const usage = extractUsageMetrics(responseData);
      const costUsd = computeUsageCostUsd(usage, budgetedSelection.model, pricing);
      const agentId = randomUUID();
      const record = createAgentRecord({ agentId, responseData, userPrompt, assistantText });
      record.model = budgetedSelection.model;
      record.route = budgetedSelection.route;
      await setCodexSession(agentId, record);
      await usageStore.recordUsage({
        user_id: params.user_id || params.userId || 'unknown',
        model: record.model,
        route: record.route,
        ...usage,
        cost_usd: costUsd,
      });
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

    async addFollowup(agentId, promptText, context = {}) {
      const record = await getCodexSession(agentId);
      if (!record) throw new Error('agent not found');
      const userPrompt = `${promptText || ''}`.trim();
      const responseData = await requestResponses(apiKey, {
        model: record.model || modelMini,
        input: userPrompt,
        ...(record.response_id && { previous_response_id: record.response_id }),
      });
      const assistantText = extractAssistantText(responseData);
      const updated = appendTurn(record, userPrompt, assistantText, responseData);
      await setCodexSession(agentId, updated);
      const usage = extractUsageMetrics(responseData);
      const followupRoute = updated.route || record.route || 'followup_same_model';
      await usageStore.recordUsage({
        user_id: context.user_id || context.userId || 'unknown',
        model: updated.model || record.model || modelMini,
        route: followupRoute,
        ...usage,
        cost_usd: computeUsageCostUsd(usage, updated.model || record.model || modelMini, pricing),
      });
      return {
        id: agentId,
        agent_id: agentId,
        state: updated.state,
        status: { state: updated.state },
        provider: 'codex',
        model: updated.model || record.model || modelMini,
        route: followupRoute,
      };
    },

    async getAgent(agentId) {
      const record = await getCodexSession(agentId);
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
      const record = await getCodexSession(agentId);
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
