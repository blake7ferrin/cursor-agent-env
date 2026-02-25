import { getRedisClient } from './redis-client.js';

const inMemoryCounters = new Map();

export function createRateLimiter(options = {}) {
  const windowMs = Number.parseInt(`${options.windowMs ?? 60000}`, 10);
  const limitPerWindow = Number.parseInt(`${options.limitPerWindow ?? 20}`, 10);
  const redisPrefix = options.redisPrefix || process.env.BRIDGE_REDIS_PREFIX || 'cursor-bridge';

  return async function applyRateLimit(req, res, next) {
    const userId = req.body?.user_id ?? req.headers['x-user-id'] ?? req.ip ?? 'unknown';
    const redis = await getRedisClient();

    if (redis) {
      const key = `${redisPrefix}:rate:${userId}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.pExpire(key, windowMs);
      if (count > limitPerWindow) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }
      return next();
    }

    const now = Date.now();
    const entry = inMemoryCounters.get(userId);
    if (!entry || now - entry.windowStart >= windowMs) {
      inMemoryCounters.set(userId, { count: 1, windowStart: now });
      return next();
    }
    if (entry.count >= limitPerWindow) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    entry.count += 1;
    inMemoryCounters.set(userId, entry);
    return next();
  };
}
