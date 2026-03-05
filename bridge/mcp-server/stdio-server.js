/**
 * MCP server over stdio (newline-delimited JSON-RPC 2.0).
 * Serves tools from bridge/mcp adapters. Use when a client (e.g. Cursor) spawns this process
 * and communicates via stdin/stdout; stderr is used for logs.
 *
 * Why stdio: MCP clients (Cursor, IDE integrations) typically spawn the server as a subprocess
 * and communicate via stdin/stdout. No port or auth is needed; the parent enforces isolation.
 * HTTP could be added later for remote tool calls (same tool-runner, different transport).
 */

import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(process.cwd(), '.env') });

import { runTool, listTools } from './tool-runner.js';

const MCP_VERSION = '2024-11-05';
const SERVER_NAME = 'cursor-bridge-mcp';

function log(...args) {
  console.error('[mcp-server]', ...args);
}

function send(response) {
  const line = JSON.stringify(response) + '\n';
  process.stdout.write(line);
}

function sendError(id, code, message) {
  send({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: code ?? -32603, message: message ?? 'Internal error' },
  });
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: MCP_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: { name: SERVER_NAME, version: '1.0.0' },
    });
    return;
  }
  if (method === 'tools/list') {
    const tools = listTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    sendResult(id, { tools });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const allowDebugRequest = process.env.ENABLE_HOUSECALL_DEBUG_REQUEST === 'true' || process.env.ENABLE_HOUSECALL_DEBUG_REQUEST === '1';
    const disabled = process.env.DISABLE_HOUSECALL_REQUEST === 'true' || process.env.DISABLE_HOUSECALL_REQUEST === '1';
    const out = await runTool(name, args, { allowDebugRequest: allowDebugRequest && !disabled });
    if (out.ok) {
      sendResult(id, {
        content: [{ type: 'text', text: JSON.stringify(out.result, null, 2) }],
        isError: false,
      });
    } else {
      sendResult(id, {
        content: [{ type: 'text', text: JSON.stringify({ error: out.error, code: out.code, details: out.details }) }],
        isError: true,
      });
    }
    return;
  }
  sendError(id, -32601, `Method not found: ${method}`);
}

function handleNotification(msg) {
  const { method } = msg;
  if (method === 'notifications/initialized') {
    log('Client initialized');
    return;
  }
  log('Unhandled notification:', method);
}

async function main() {
  const buf = [];
  let pendingRequests = 0;
  let stdinClosed = false;
  const maybeExit = () => {
    if (stdinClosed && pendingRequests === 0) {
      process.exit(0);
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    const lines = (buf.push(chunk) && buf.join('').split(/\n/)) || [];
    buf.length = 0;
    const last = lines.pop();
    if (last !== undefined && last !== '') buf.push(last);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.method !== undefined && msg.id === undefined) {
          handleNotification(msg);
        } else {
          pendingRequests += 1;
          try {
            await handleRequest(msg);
          } finally {
            pendingRequests -= 1;
            maybeExit();
          }
        }
      } catch (err) {
        log('Parse/handle error:', err);
        sendError(undefined, -32700, err.message || 'Parse error');
      }
    }
  });
  process.stdin.on('end', () => {
    stdinClosed = true;
    maybeExit();
  });
  log('MCP server listening on stdio');
}

main().catch((err) => {
  log(err);
  process.exit(1);
});
