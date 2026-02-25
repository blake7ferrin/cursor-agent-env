/**
 * File-backed store for user -> agent_id mapping.
 * Persists across bridge restarts without requiring a database.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRedisClient } from './redis-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = process.env.BRIDGE_STORE_PATH || path.join(__dirname, 'data', 'agents.json');
const REDIS_PREFIX = process.env.BRIDGE_REDIS_PREFIX || 'cursor-bridge';

const agentsByUser = new Map();

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    for (const [userId, agentId] of Object.entries(parsed)) {
      if (typeof userId === 'string' && typeof agentId === 'string' && agentId) {
        agentsByUser.set(userId, agentId);
      }
    }
  } catch (err) {
    console.error(`Failed to load store at ${STORE_PATH}: ${err.message}`);
  }
}

function persistStore() {
  try {
    ensureParentDir(STORE_PATH);
    const tmp = `${STORE_PATH}.tmp`;
    const data = JSON.stringify(Object.fromEntries(agentsByUser), null, 2);
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, STORE_PATH);
  } catch (err) {
    console.error(`Failed to persist store at ${STORE_PATH}: ${err.message}`);
  }
}

loadStore();

function getRedisKey(userId) {
  return `${REDIS_PREFIX}:agent:${userId}`;
}

export async function getAgentId(userId) {
  const redis = await getRedisClient();
  if (redis) {
    return redis.get(getRedisKey(userId));
  }
  return agentsByUser.get(userId) ?? null;
}

export async function setAgentId(userId, agentId) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(getRedisKey(userId), agentId);
    return;
  }
  agentsByUser.set(userId, agentId);
  persistStore();
}

export async function clearAgentId(userId) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(getRedisKey(userId));
    return;
  }
  if (agentsByUser.delete(userId)) persistStore();
}
