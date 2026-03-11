import { getRedisClient } from './redis-client.js';

const REDIS_PREFIX = process.env.BRIDGE_REDIS_PREFIX || 'cursor-bridge';
const USAGE_TTL_SECONDS = Number.parseInt(
  process.env.BRIDGE_CODEX_USAGE_TTL_SECONDS || `${60 * 60 * 24 * 120}`,
  10,
); // 120 days

const inMemoryMonthlyUsage = new Map();

function usageKey(month) {
  return `${REDIS_PREFIX}:codex:usage:${month}`;
}

function normalizeMonth(month) {
  if (month && /^\d{4}-\d{2}$/.test(month)) return month;
  return new Date().toISOString().slice(0, 7);
}

function emptyStats(month) {
  return {
    month,
    total: {
      requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
    },
    by_model: {},
    by_route: {},
    by_user: {},
    updated_at: new Date().toISOString(),
  };
}

function ensureBucket(root, key) {
  if (!root[key]) {
    root[key] = {
      requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
    };
  }
  return root[key];
}

function applyUsage(target, usage) {
  target.requests += 1;
  target.input_tokens += usage.input_tokens;
  target.output_tokens += usage.output_tokens;
  target.total_tokens += usage.total_tokens;
  target.cost_usd += usage.cost_usd;
}

function sanitizeUsage(usage = {}) {
  const n = (value) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    input_tokens: n(usage.input_tokens),
    output_tokens: n(usage.output_tokens),
    total_tokens: n(usage.total_tokens),
    cost_usd: n(usage.cost_usd),
  };
}

function roundCurrency(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1e6) / 1e6;
}

function normalizeStatFloats(summary) {
  const normalizeBucket = (bucket) => {
    bucket.cost_usd = roundCurrency(bucket.cost_usd);
    return bucket;
  };
  normalizeBucket(summary.total);
  Object.values(summary.by_model).forEach(normalizeBucket);
  Object.values(summary.by_route).forEach(normalizeBucket);
  Object.values(summary.by_user).forEach(normalizeBucket);
  return summary;
}

async function loadMonthlySummary(month) {
  const normalizedMonth = normalizeMonth(month);
  const redis = await getRedisClient();
  if (redis) {
    const raw = await redis.get(usageKey(normalizedMonth));
    if (!raw) return emptyStats(normalizedMonth);
    try {
      const parsed = JSON.parse(raw);
      return { ...emptyStats(normalizedMonth), ...parsed, month: normalizedMonth };
    } catch (_) {
      return emptyStats(normalizedMonth);
    }
  }
  return inMemoryMonthlyUsage.get(normalizedMonth) || emptyStats(normalizedMonth);
}

async function saveMonthlySummary(summary) {
  const normalized = normalizeStatFloats({
    ...summary,
    updated_at: new Date().toISOString(),
  });
  const redis = await getRedisClient();
  if (redis) {
    await redis.setEx(usageKey(normalized.month), USAGE_TTL_SECONDS, JSON.stringify(normalized));
    return normalized;
  }
  inMemoryMonthlyUsage.set(normalized.month, normalized);
  return normalized;
}

export async function recordCodexUsage(entry = {}) {
  const month = normalizeMonth(entry.month);
  const model = `${entry.model || 'unknown'}`;
  const route = `${entry.route || 'unknown'}`;
  const userId = `${entry.user_id || entry.userId || 'unknown'}`;
  const usage = sanitizeUsage(entry);

  const summary = await loadMonthlySummary(month);
  applyUsage(summary.total, usage);
  applyUsage(ensureBucket(summary.by_model, model), usage);
  applyUsage(ensureBucket(summary.by_route, route), usage);
  applyUsage(ensureBucket(summary.by_user, userId), usage);

  return saveMonthlySummary(summary);
}

export async function getCodexUsageSummary(month) {
  return loadMonthlySummary(month);
}

export async function getCodexMonthlyCostUsd(month) {
  const summary = await loadMonthlySummary(month);
  return Number(summary?.total?.cost_usd || 0);
}
