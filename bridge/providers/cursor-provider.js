import * as cursorApi from '../cursor-api.js';

export function createCursorProvider(options = {}) {
  const apiKey = options.apiKey || process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error('Missing CURSOR_API_KEY. Set CURSOR_API_KEY or choose a different AGENT_PROVIDER.');
  }

  return {
    name: 'cursor',
    launchAgent: (params) => cursorApi.launchAgent(apiKey, params),
    addFollowup: (agentId, promptText) => cursorApi.addFollowup(apiKey, agentId, promptText),
    getAgent: (agentId) => cursorApi.getAgent(apiKey, agentId),
    getAgentConversation: (agentId) => cursorApi.getAgentConversation(apiKey, agentId),
    waitForAgent: (agentId, waitOptions) => cursorApi.waitForAgent(apiKey, agentId, waitOptions),
  };
}
