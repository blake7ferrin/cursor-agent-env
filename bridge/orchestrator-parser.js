/**
 * Parse orchestrator protocol lines from agent response text.
 * See docs/orchestrator-protocol.md in the agent-env repo.
 */

/**
 * @param {string} text - Full assistant message or conversation text
 * @returns {{ subagents: Array<{ repo: string, prompt: string }>, localActions: string[], housecallExports: object[] }}
 */
export function parseOrchestratorCommands(text) {
  const subagents = [];
  const localActions = [];
  const housecallExports = [];
  if (!text || typeof text !== 'string') return { subagents, localActions, housecallExports };

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('SUBAGENT:')) {
      const rest = trimmed.slice('SUBAGENT:'.length).trim();
      const repoMatch = rest.match(/repo\s*=\s*([^,]+)/i);
      const promptMatch = rest.match(/prompt\s*=\s*(.+)/i);
      const repo = repoMatch ? repoMatch[1].trim() : '';
      const prompt = promptMatch ? promptMatch[1].trim() : '';
      if (repo && prompt) subagents.push({ repo, prompt });
    } else if (trimmed.startsWith('LOCAL_ACTION:')) {
      const actionId = trimmed.slice('LOCAL_ACTION:'.length).trim();
      if (actionId) localActions.push(actionId);
    } else if (trimmed.startsWith('HOUSECALL_EXPORT:')) {
      const jsonStr = trimmed.slice('HOUSECALL_EXPORT:'.length).trim();
      if (jsonStr) {
        try {
          const payload = JSON.parse(jsonStr);
          if (payload && typeof payload === 'object') housecallExports.push(payload);
        } catch (_) {
          // invalid JSON, skip
        }
      }
    }
  }
  return { subagents, localActions, housecallExports };
}
