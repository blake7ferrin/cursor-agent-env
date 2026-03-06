/**
 * Server integration tests: async chat, validation, idempotency, Housecall debug flag.
 * Requires BRIDGE_AUTH_TOKEN and CURSOR_API_KEY to be set (or set below for CI).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// Set auth so server module can load (it exits if missing)
process.env.BRIDGE_AUTH_TOKEN = process.env.BRIDGE_AUTH_TOKEN || 'test-bridge-token';
process.env.CURSOR_API_KEY = process.env.CURSOR_API_KEY || 'key-test-placeholder';
process.env.USE_MCP_TOOLS = 'true';

const { app } = await import('../server.js');

const auth = { Authorization: 'Bearer test-bridge-token' };

test('GET /health returns 200 ok', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
});

test('POST /chat with async=true returns 202 and job_id', async () => {
  const res = await request(app)
    .post('/chat?async=true')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ user_id: 'test-async-user', message: 'hello' });
  assert.equal(res.status, 202);
  assert.ok(res.body?.job_id);
  assert.equal(res.body?.status, 'pending');
  assert.ok(res.body?.status_url);
});

test('GET /jobs/:id returns 200 with job when job exists', async () => {
  const create = await request(app)
    .post('/chat?async=true')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ user_id: 'test-job-user', message: 'hi' });
  assert.equal(create.status, 202);
  const jobId = create.body?.job_id;
  assert.ok(jobId);

  const get = await request(app).get(`/jobs/${jobId}`).set(auth);
  assert.equal(get.status, 200);
  assert.equal(get.body?.job_id, jobId);
  assert.ok(['pending', 'running', 'completed', 'failed'].includes(get.body?.status));
});

test('GET /jobs/:id returns 404 for unknown job', async () => {
  const res = await request(app).get('/jobs/non-existent-id').set(auth);
  assert.equal(res.status, 404);
});

test('POST /chat with invalid body returns 400 with details', async () => {
  const res = await request(app)
    .post('/chat')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ user_id: 'u' });
  assert.equal(res.status, 400);
  assert.ok(res.body?.error);
  assert.ok(Array.isArray(res.body?.details));
});

test('POST /estimator/export/housecall idempotency: duplicate key returns 200 with X-Idempotency-Replay', async () => {
  const key = `idem-test-${Date.now()}`;
  const userId = 'idem-user';
  await request(app)
    .put('/estimator/config')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ user_id: userId, config: { laborRatePerHour: 100, targetGrossMargin: 0.4 } });

  const body = {
    user_id: userId,
    idempotency_key: key,
    customer: { name: 'Test' },
    selections: [],
    manual_items: [{ name: 'Test line', quantity: 1, unitCost: 100 }],
    housecall: { dry_run: true },
  };

  const first = await request(app)
    .post('/estimator/export/housecall')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send(body);
  if (first.status !== 200) {
    assert.fail(`First export request failed with ${first.status}: ${JSON.stringify(first.body)}`);
  }
  assert.equal(first.headers['x-idempotency-replay'], undefined);

  const second = await request(app)
    .post('/estimator/export/housecall')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send(body);
  assert.equal(second.status, 200);
  assert.equal(second.headers['x-idempotency-replay'], 'true');
});

test('POST /integrations/housecall/request returns 403 when debug flag not enabled', async () => {
  const res = await request(app)
    .post('/integrations/housecall/request')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ path: '/v1/customers' });
  assert.equal(res.status, 403);
  assert.ok(res.body?.error?.includes('disabled'));
});

test('GET /mcp/tools returns 200 and list of tools when USE_MCP_TOOLS=true', async () => {
  const res = await request(app).get('/mcp/tools').set(auth);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body?.tools));
  assert.ok(res.body.tools.some((t) => t.name === 'housecall.get_config'));
  assert.ok(res.body.tools.some((t) => t.name === 'catalog.get_report'));
  assert.ok(res.body.tools.some((t) => t.name === 'scheduler.resolve_context'));
});

test('POST /mcp/call housecall.get_config returns 200 with result', async () => {
  const res = await request(app)
    .post('/mcp/call')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ tool: 'housecall.get_config', arguments: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
  assert.ok(typeof res.body?.result === 'object');
});

test('POST /mcp/call catalog.get_report returns 200 with result', async () => {
  const res = await request(app)
    .post('/mcp/call')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ tool: 'catalog.get_report', arguments: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
});

test('POST /mcp/call missing tool name returns 400', async () => {
  const res = await request(app)
    .post('/mcp/call')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ arguments: {} });
  assert.equal(res.status, 400);
  assert.equal(res.body?.ok, false);
  assert.ok(res.body?.error?.includes('Missing tool name'));
});

test('POST /mcp/call housecall.request returns tool error when debug disabled', async () => {
  const res = await request(app)
    .post('/mcp/call')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ tool: 'housecall.request', arguments: { path: '/v1/customers' } });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, false);
  assert.equal(res.body?.code, 'TOOL_DISABLED');
});

test('POST /mcp/call validation error returns ok: false with code VALIDATION_ERROR', async () => {
  const res = await request(app)
    .post('/mcp/call')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ tool: 'catalog.get_item_by_sku', arguments: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, false);
  assert.equal(res.body?.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(res.body?.details));
});

test('POST /mcp initialize returns JSON-RPC capabilities', async () => {
  const res = await request(app)
    .post('/mcp')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body?.jsonrpc, '2.0');
  assert.equal(res.body?.id, 1);
  assert.equal(res.body?.result?.protocolVersion, '2024-11-05');
  assert.ok(typeof res.body?.result?.serverInfo?.name === 'string');
});

test('POST /mcp tools/list returns tool registry', async () => {
  const res = await request(app)
    .post('/mcp')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body?.jsonrpc, '2.0');
  assert.equal(res.body?.id, 2);
  assert.ok(Array.isArray(res.body?.result?.tools));
  assert.ok(res.body.result.tools.some((t) => t.name === 'housecall.get_config'));
});

test('POST /mcp tools/call returns MCP content payload', async () => {
  const res = await request(app)
    .post('/mcp')
    .set(auth)
    .set('Content-Type', 'application/json')
    .send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'housecall.get_config', arguments: {} },
    });
  assert.equal(res.status, 200);
  assert.equal(res.body?.jsonrpc, '2.0');
  assert.equal(res.body?.id, 3);
  assert.equal(res.body?.result?.isError, false);
  assert.ok(Array.isArray(res.body?.result?.content));
  assert.equal(res.body.result.content[0]?.type, 'text');
});
