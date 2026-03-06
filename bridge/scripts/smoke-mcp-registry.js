/**
 * Smoke test for MCP registry-friendly JSON-RPC endpoint.
 *
 * Usage:
 *   BASE_URL=https://bridge.example.com BRIDGE_AUTH_TOKEN=token npm run test:mcp-registry
 */

const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const token = process.env.BRIDGE_AUTH_TOKEN || '';

if (!token) {
  console.error('Missing BRIDGE_AUTH_TOKEN');
  process.exit(1);
}

async function rpc(method, params, id) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  if (body.error) throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
  return body.result;
}

async function main() {
  const init = await rpc('initialize', {}, 1);
  if (!init?.protocolVersion) throw new Error('initialize missing protocolVersion');
  console.log('[ok] initialize');

  const listed = await rpc('tools/list', {}, 2);
  const tools = listed?.tools || [];
  if (!Array.isArray(tools) || tools.length === 0) throw new Error('tools/list returned empty tools');
  console.log('[ok] tools/list', `${tools.length} tools`);

  const called = await rpc('tools/call', { name: 'housecall.get_config', arguments: {} }, 3);
  if (!Array.isArray(called?.content) || called.content.length === 0) throw new Error('tools/call missing content');
  if (called.isError) throw new Error(`tools/call returned isError=true: ${called.content[0]?.text || ''}`);
  console.log('[ok] tools/call');
}

main().catch((err) => {
  console.error('[fail]', err.message || err);
  process.exit(1);
});
