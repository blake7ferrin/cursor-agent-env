/**
 * In-memory store for user -> agent_id mapping.
 * Replace with file or DB for persistence across restarts.
 */

const agentsByUser = new Map();

export function getAgentId(userId) {
  return agentsByUser.get(userId) ?? null;
}

export function setAgentId(userId, agentId) {
  agentsByUser.set(userId, agentId);
}

export function clearAgentId(userId) {
  agentsByUser.delete(userId);
}
