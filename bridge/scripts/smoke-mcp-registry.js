/**
 * Smoke test for MCP registry-compatible JSON-RPC endpoint.
 *
 * Usage:
 *   BRIDGE_AUTH_TOKEN=... [BASE_URL=https://bridge.example.com] node scripts/smoke-mcp-registry.js
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_TOKEN = process.env.BRIDGE_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error('Missing BRIDGE_AUTH_TOKEN');
  process.exit(1);
}

async function mcp(method, params, id) {
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: params || {},
    }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = { raw: text };
  }

  return { status: response.status, payload };
}

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
    }
    process.exit(1);
  }
}

async function main() {
  console.log(`BASE_URL=${BASE_URL}`);

  const initialize = await mcp('initialize', {}, 1);
  assert(initialize.status === 200, 'initialize did not return HTTP 200', initialize);
  assert(initialize.payload?.result?.protocolVersion, 'initialize missing protocolVersion', initialize.payload);
  console.log(`OK initialize: protocol=${initialize.payload.result.protocolVersion}`);

  const list = await mcp('tools/list', {}, 2);
  assert(list.status === 200, 'tools/list did not return HTTP 200', list);
  const tools = list.payload?.result?.tools;
  assert(Array.isArray(tools), 'tools/list missing tools array', list.payload);
  assert(tools.some((t) => t.name === 'housecall.get_config'), 'housecall.get_config missing from tools/list', tools);
  console.log(`OK tools/list: count=${tools.length}`);

  const getConfig = await mcp('tools/call', { name: 'housecall.get_config', arguments: {} }, 3);
  assert(getConfig.status === 200, 'tools/call did not return HTTP 200', getConfig);
  assert(getConfig.payload?.result?.isError === false, 'housecall.get_config call returned error', getConfig.payload);
  console.log('OK tools/call housecall.get_config');

  console.log('\nMCP registry smoke test passed.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
