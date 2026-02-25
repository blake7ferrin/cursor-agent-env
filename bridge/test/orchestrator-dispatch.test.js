import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatcher } from '../orchestrator-dispatch.js';

test('dispatcher launches allowed subagent and executes allowed local action', async () => {
  const launched = [];
  const actions = [];
  const dispatch = createDispatcher({
    subagentRepoAllowlist: ['https://github.com/acme/app'],
    localActionAllowlist: ['backup_script'],
    launchSubagent: async (params) => {
      launched.push(params);
      return { id: 'agent_123' };
    },
    runLocalAction: async ({ action }) => {
      actions.push(action);
      return { ok: true, status: 200, body: 'ok' };
    },
  });

  const text = [
    'SUBAGENT: repo=github.com/acme/app, prompt=Do a task',
    'LOCAL_ACTION: backup_script',
  ].join('\n');

  const result = await dispatch(text);
  assert.equal(launched.length, 1);
  assert.equal(actions.length, 1);
  assert.equal(result.dispatched.subagents[0].status, 'launched');
  assert.equal(result.dispatched.localActions[0].status, 'executed');
});

test('dispatcher skips disallowed commands', async () => {
  const dispatch = createDispatcher({
    subagentRepoAllowlist: ['https://github.com/acme/allowed'],
    localActionAllowlist: ['allowed_action'],
    launchSubagent: async () => ({ id: 'unused' }),
    runLocalAction: async () => ({ ok: true, status: 200, body: 'ok' }),
  });

  const text = [
    'SUBAGENT: repo=github.com/acme/not-allowed, prompt=Nope',
    'LOCAL_ACTION: not_allowed_action',
  ].join('\n');
  const result = await dispatch(text);

  assert.equal(result.dispatched.subagents[0].status, 'skipped');
  assert.equal(result.dispatched.subagents[0].error, 'repo_not_allowed');
  assert.equal(result.dispatched.localActions[0].status, 'skipped');
  assert.equal(result.dispatched.localActions[0].error, 'action_not_allowed');
});
