import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrchestratorCommands } from '../orchestrator-parser.js';

test('parseOrchestratorCommands extracts subagents and local actions', () => {
  const text = [
    'hello',
    'SUBAGENT: repo=github.com/org/repo-one, prompt=Implement health check',
    'LOCAL_ACTION: backup_script',
    'SUBAGENT: repo=https://github.com/org/repo-two, prompt=Add metrics',
  ].join('\n');

  const result = parseOrchestratorCommands(text);
  assert.equal(result.subagents.length, 2);
  assert.deepEqual(result.localActions, ['backup_script']);
  assert.equal(result.subagents[0].repo, 'github.com/org/repo-one');
  assert.equal(result.subagents[0].prompt, 'Implement health check');
});

test('parseOrchestratorCommands ignores malformed lines', () => {
  const text = [
    'SUBAGENT: prompt=Missing repo',
    'SUBAGENT: repo=github.com/org/repo',
    'LOCAL_ACTION:',
  ].join('\n');

  const result = parseOrchestratorCommands(text);
  assert.deepEqual(result.subagents, []);
  assert.deepEqual(result.localActions, []);
});

test('parseOrchestratorCommands extracts HOUSECALL_EXPORT JSON', () => {
  const text = [
    'Here is the estimate.',
    'HOUSECALL_EXPORT: {"customer":{"name":"Jane"},"selections":[{"sku":"HP-3T","quantity":1}],"housecall":{"dry_run":true}}',
    'Done.',
  ].join('\n');

  const result = parseOrchestratorCommands(text);
  assert.equal(result.housecallExports.length, 1);
  assert.equal(result.housecallExports[0].customer.name, 'Jane');
  assert.deepEqual(result.housecallExports[0].selections, [{ sku: 'HP-3T', quantity: 1 }]);
  assert.equal(result.housecallExports[0].housecall.dry_run, true);
});

test('parseOrchestratorCommands skips invalid HOUSECALL_EXPORT JSON', () => {
  const result = parseOrchestratorCommands('HOUSECALL_EXPORT: not json {');
  assert.equal(result.housecallExports.length, 0);
});
