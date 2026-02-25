import { parseOrchestratorCommands } from './orchestrator-parser.js';

function normalizeRepoUrl(repo) {
  const trimmed = repo.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '').toLowerCase();
}

export function createDispatcher(options = {}) {
  const allowedRepos = new Set((options.subagentRepoAllowlist ?? []).map(normalizeRepoUrl));
  const allowedActions = new Set(options.localActionAllowlist ?? []);
  const launchSubagent = options.launchSubagent;
  const runLocalAction = options.runLocalAction;

  return async function dispatchOrchestratorCommands(text) {
    const { subagents, localActions } = parseOrchestratorCommands(text);
    const dispatched = { subagents: [], localActions: [] };

    for (const cmd of subagents) {
      const normalized = normalizeRepoUrl(cmd.repo);
      if (!allowedRepos.size || !allowedRepos.has(normalized)) {
        dispatched.subagents.push({
          repo: cmd.repo,
          prompt: cmd.prompt,
          status: 'skipped',
          error: 'repo_not_allowed',
        });
        continue;
      }
      if (typeof launchSubagent !== 'function') {
        dispatched.subagents.push({
          repo: normalized,
          prompt: cmd.prompt,
          status: 'skipped',
          error: 'missing_subagent_launcher',
        });
        continue;
      }
      try {
        const launched = await launchSubagent({ repository: normalized, promptText: cmd.prompt });
        dispatched.subagents.push({
          repo: normalized,
          prompt: cmd.prompt,
          status: 'launched',
          agent_id: launched.id ?? launched.agent_id ?? null,
        });
      } catch (err) {
        dispatched.subagents.push({
          repo: normalized,
          prompt: cmd.prompt,
          status: 'error',
          error: err.message,
        });
      }
    }

    for (const actionId of localActions) {
      if (!allowedActions.size || !allowedActions.has(actionId)) {
        dispatched.localActions.push({
          action: actionId,
          status: 'skipped',
          error: 'action_not_allowed',
        });
        continue;
      }
      if (typeof runLocalAction !== 'function') {
        dispatched.localActions.push({
          action: actionId,
          status: 'skipped',
          error: 'missing_local_action_runner',
        });
        continue;
      }
      try {
        const result = await runLocalAction({ action: actionId });
        dispatched.localActions.push({
          action: actionId,
          status: result.ok ? 'executed' : 'error',
          response_status: result.status,
          response_body: (result.body ?? '').slice(0, 500),
        });
      } catch (err) {
        dispatched.localActions.push({
          action: actionId,
          status: 'error',
          error: err.message,
        });
      }
    }

    return { parsed: { subagents, localActions }, dispatched };
  };
}
