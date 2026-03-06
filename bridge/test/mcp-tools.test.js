/**
 * MCP tool runner and tool list tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { runTool, listTools } from '../mcp-server/tool-runner.js';

test('listTools returns all expected tool names', () => {
  const tools = listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('housecall.get_config'));
  assert.ok(names.includes('housecall.test_connection'));
  assert.ok(names.includes('housecall.request'));
  assert.ok(names.includes('housecall.list_customers'));
  assert.ok(names.includes('housecall.resolve_context'));
  assert.ok(names.includes('catalog.get_report'));
  assert.ok(names.includes('catalog.load'));
  assert.ok(names.includes('catalog.get_item_by_sku'));
  assert.ok(names.includes('catalog.query_by_attribute'));
  assert.ok(names.includes('scheduler.resolve_context'));
  assert.equal(tools.length, 10);
});

test('runTool unknown tool returns UNKNOWN_TOOL', async () => {
  const out = await runTool('no.such.tool', {});
  assert.equal(out.ok, false);
  assert.equal(out.code, 'UNKNOWN_TOOL');
  assert.ok(out.error.includes('Unknown tool'));
});

test('runTool housecall.get_config returns ok and result', async () => {
  const out = await runTool('housecall.get_config', {});
  assert.equal(out.ok, true);
  assert.ok(typeof out.result === 'object');
  assert.ok('authMode' in out.result || 'hasApiKey' in out.result);
});

test('runTool housecall.request without allowDebugRequest returns TOOL_DISABLED', async () => {
  const out = await runTool('housecall.request', { path: '/customers' }, { allowDebugRequest: false });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'TOOL_DISABLED');
  assert.ok(out.error.includes('disabled'));
});

test('runTool catalog.get_report returns ok and result', async () => {
  const out = await runTool('catalog.get_report', {});
  assert.equal(out.ok, true);
  assert.ok(out.result === null || (typeof out.result === 'object'));
});

test('runTool catalog.load returns items array and count', async () => {
  const out = await runTool('catalog.load', { profile: 'preferred' });
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.result.items));
  assert.equal(typeof out.result.count, 'number');
});

test('runTool catalog.get_item_by_sku missing sku returns VALIDATION_ERROR', async () => {
  const out = await runTool('catalog.get_item_by_sku', {});
  assert.equal(out.ok, false);
  assert.equal(out.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(out.details));
});

test('runTool scheduler.resolve_context missing appointment_id returns VALIDATION_ERROR', async () => {
  const out = await runTool('scheduler.resolve_context', {});
  assert.equal(out.ok, false);
  assert.equal(out.code, 'VALIDATION_ERROR');
});

test('runTool housecall.resolve_context invalid path format returns VALIDATION_ERROR', async () => {
  const out = await runTool('housecall.request', { path: 'invalid-no-slash' }, { allowDebugRequest: true });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'VALIDATION_ERROR');
});

test('runTool catalog.query_by_attribute missing attribute_key returns VALIDATION_ERROR', async () => {
  const out = await runTool('catalog.query_by_attribute', { value: 'x' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'VALIDATION_ERROR');
});
