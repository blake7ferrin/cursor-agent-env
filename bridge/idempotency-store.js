/**
 * Idempotency key store per user + route with TTL.
 * Redis when REDIS_URL is set, in-memory fallback otherwise.
 * Used for POST /estimator/export/housecall to prevent double-send.
 */

import { getRedisClient } from './redis-client.js';

const REDIS_PREFIX = process.env.BRIDGE_REDIS_PREFIX || 'cursor-bridge';
const IDEMPOTENCY_TTL_SECONDS = Number.parseInt(process.env.BRIDGE_IDEMPOTENCY_TTL_SECONDS || '86400', 10); // 24h

/** @type {Map<string, { result: object, expiresAt: number }>} */
const inMemoryKeys = new Map();

function storeKey(userId, key) {
  return `${REDIS_PREFIX}:idem:${userId}:${key}`;
}

/**
 * Get stored result for an idempotency key (if any).
 * @param {string} userId
 * @param {string} idempotencyKey
 * @returns {Promise<object|null>}
 */
export async function getIdempotencyResult(userId, idempotencyKey) {
  if (!userId || !idempotencyKey || typeof idempotencyKey !== 'string') return null;

  const key = storeKey(userId, idempotencyKey);
  const redis = await getRedisClient();

  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  const entry = inMemoryKeys.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.result;
}

/**
 * Store result for an idempotency key (only when we performed the operation).
 * @param {string} userId
 * @param {string} idempotencyKey
 * @param {object} result
 */
export async function setIdempotencyResult(userId, idempotencyKey, result) {
  if (!userId || !idempotencyKey || typeof idempotencyKey !== 'string') return;

  const key = storeKey(userId, idempotencyKey);
  const redis = await getRedisClient();

  if (redis) {
    await redis.setEx(key, IDEMPOTENCY_TTL_SECONDS, JSON.stringify(result));
    return;
  }

  const now = Date.now();
  inMemoryKeys.set(key, {
    result,
    expiresAt: now + IDEMPOTENCY_TTL_SECONDS * 1000,
  });
}

/**
 * Try to record an idempotency key and return whether it's a duplicate.
 * @param {string} userId - user identifier
 * @param {string} idempotencyKey - client-provided key
 * @param {object} result - response to store for duplicate requests
 * @returns {Promise<{ duplicate: boolean, storedResult?: object }>}
 */
export async function checkAndStoreIdempotency(userId, idempotencyKey, result) {
  if (!userId || !idempotencyKey || typeof idempotencyKey !== 'string') {
    return { duplicate: false };
  }

  const key = storeKey(userId, idempotencyKey);
  const redis = await getRedisClient();

  if (redis) {
    const existing = await redis.get(key);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        return { duplicate: true, storedResult: parsed };
      } catch (_) {
        return { duplicate: true, storedResult: { idempotency_replay: true } };
      }
    }
    await redis.setEx(key, IDEMPOTENCY_TTL_SECONDS, JSON.stringify(result));
    return { duplicate: false };
  }

  const now = Date.now();
  const entry = inMemoryKeys.get(key);
  if (entry && entry.expiresAt > now) {
    return { duplicate: true, storedResult: entry.result };
  }

  inMemoryKeys.set(key, {
    result,
    expiresAt: now + IDEMPOTENCY_TTL_SECONDS * 1000,
  });
  // Simple cleanup: remove expired entries when storing (optional, prevents unbounded growth)
  for (const [k, v] of inMemoryKeys.entries()) {
    if (v.expiresAt <= now) inMemoryKeys.delete(k);
  }
  return { duplicate: false };
}
