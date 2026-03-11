import { getRedisClient } from './redis-client.js';

const REDIS_PREFIX = process.env.BRIDGE_REDIS_PREFIX || 'cursor-bridge';
const SESSION_TTL_SECONDS = Number.parseInt(
  process.env.BRIDGE_CODEX_SESSION_TTL_SECONDS || '604800',
  10,
); // 7 days

const inMemorySessions = new Map();

function sessionKey(agentId) {
  return `${REDIS_PREFIX}:codex:session:${agentId}`;
}

function cleanupExpiredInMemory(now = Date.now()) {
  for (const [key, value] of inMemorySessions.entries()) {
    if (value.expiresAt <= now) inMemorySessions.delete(key);
  }
}

export async function getCodexSession(agentId) {
  if (!agentId || typeof agentId !== 'string') return null;
  const redis = await getRedisClient();
  if (redis) {
    const raw = await redis.get(sessionKey(agentId));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  const entry = inMemorySessions.get(agentId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    inMemorySessions.delete(agentId);
    return null;
  }
  return entry.data;
}

export async function setCodexSession(agentId, session) {
  if (!agentId || typeof agentId !== 'string') return;
  const redis = await getRedisClient();
  if (redis) {
    await redis.setEx(sessionKey(agentId), SESSION_TTL_SECONDS, JSON.stringify(session));
    return;
  }

  const now = Date.now();
  inMemorySessions.set(agentId, {
    data: session,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
  });
  cleanupExpiredInMemory(now);
}

export async function deleteCodexSession(agentId) {
  if (!agentId || typeof agentId !== 'string') return;
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(sessionKey(agentId));
    return;
  }
  inMemorySessions.delete(agentId);
}
