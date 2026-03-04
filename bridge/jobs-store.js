/**
 * Async job store: Redis when REDIS_URL is set, in-memory fallback otherwise.
 * Used for POST /chat async mode and GET /jobs/:id.
 */

import { randomUUID } from 'node:crypto';
import { getRedisClient } from './redis-client.js';

const REDIS_PREFIX = process.env.BRIDGE_REDIS_PREFIX || 'cursor-bridge';
const JOB_TTL_SECONDS = Number.parseInt(process.env.BRIDGE_JOB_TTL_SECONDS || '86400', 10); // 24h default

const inMemoryJobs = new Map();

function jobKey(id) {
  return `${REDIS_PREFIX}:job:${id}`;
}

/**
 * Create a new job and return its id.
 * @param {object} data - { user_id, agent_id? }
 * @returns {Promise<string>} job_id
 */
export async function createJob(data) {
  const id = randomUUID();
  const record = {
    id,
    user_id: data.user_id,
    agent_id: data.agent_id ?? null,
    status: 'pending',
    result: null,
    error: null,
    created_at: new Date().toISOString(),
  };

  const redis = await getRedisClient();
  if (redis) {
    await redis.setEx(jobKey(id), JOB_TTL_SECONDS, JSON.stringify(record));
    return id;
  }

  inMemoryJobs.set(id, record);
  return id;
}

/**
 * Get job by id.
 * @param {string} id - job_id
 * @returns {Promise<object|null>} job record or null
 */
export async function getJob(id) {
  if (!id || typeof id !== 'string') return null;

  const redis = await getRedisClient();
  if (redis) {
    const raw = await redis.get(jobKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  return inMemoryJobs.get(id) ?? null;
}

/**
 * Update job status and optional result/error.
 * @param {string} id - job_id
 * @param {object} update - { status, result?, error? }
 */
export async function updateJob(id, update) {
  if (!id || typeof id !== 'string') return;

  const redis = await getRedisClient();
  if (redis) {
    const existing = await getJob(id);
    if (!existing) return;
    const next = { ...existing, ...update };
    await redis.setEx(jobKey(id), JOB_TTL_SECONDS, JSON.stringify(next));
    return;
  }

  const record = inMemoryJobs.get(id);
  if (record) {
    Object.assign(record, update);
  }
}
