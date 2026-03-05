# Cloud + Local Hybrid Setup (Bridge + MCP Registry + Local Actions)

This is the fastest path to run Housecall/estimator tooling remotely while still keeping optional access to your local PC.

## Target architecture

1. **Cloud bridge (always on)**  
   Hosts chat + orchestrator + MCP endpoints + Housecall credentials.
2. **Cursor MCP Registry entry (remote)**  
   Points to your cloud bridge MCP JSON-RPC endpoint (`/mcp`).
3. **Local action relay (optional, on your PC)**  
   Handles device-only actions through `LOCAL_ACTION` allowlist.

This gives you both: cloud reliability and local machine control.

## 1) Required secrets (Doppler or env)

Set these for your cloud bridge runtime:

- `CURSOR_API_KEY`
- `BRIDGE_AUTH_TOKEN`
- `AGENT_ENV_REPO`
- `HCP_API_KEY` (or `HOUSECALL_PRO_API_KEY`)
- `USE_MCP_TOOLS=true`

Recommended:

- `REDIS_URL` (durable jobs, idempotency, rate limits)
- `BRIDGE_PUBLIC_URL=https://<your-bridge-domain>`
- `TELEGRAM_BOT_TOKEN` (if Telegram is desired)
- `LOCAL_ACTION_ENDPOINT=https://<your-local-relay-endpoint>/run` (if using local actions)
- `LOCAL_ACTION_AUTH_TOKEN=<shared-secret>`
- `LOCAL_ACTION_ALLOWLIST=backup_script,open_browser,lock_screen` (example)

## 2) Deploy bridge to cloud

Any Node host works (VM/container/PaaS). Start command:

```bash
cd bridge
npm install
node server.js
```

Use your platform’s secret manager or `doppler run -- node server.js`.

## 3) Verify the cloud bridge is healthy

```bash
curl -s https://<your-bridge-domain>/health
```

Expected: `{"ok":true}`

## 4) Verify MCP endpoint for registry use

The bridge now exposes JSON-RPC at:

- `POST https://<your-bridge-domain>/mcp`

Auth header (required):

- `Authorization: Bearer <BRIDGE_AUTH_TOKEN>`

One-command smoke test:

```bash
cd bridge
BASE_URL=https://<your-bridge-domain> BRIDGE_AUTH_TOKEN=<token> npm run test:mcp-registry
```

## 5) Cursor MCP Registry configuration

Create a remote MCP server entry that targets:

- **URL:** `https://<your-bridge-domain>/mcp`
- **Header:** `Authorization: Bearer <BRIDGE_AUTH_TOKEN>`

If your MCP client asks for protocol/methods, use standard MCP JSON-RPC calls:

- `initialize`
- `tools/list`
- `tools/call`

The server returns tools including:

- `housecall.*`
- `catalog.*`
- `scheduler.resolve_context`

## 6) Keep local-PC control in parallel (optional)

Run a tiny relay on your PC that accepts whitelisted action IDs and executes local scripts.

Bridge settings:

- `LOCAL_ACTION_ENDPOINT`
- `LOCAL_ACTION_AUTH_TOKEN`
- `LOCAL_ACTION_ALLOWLIST`

Agent flow:

1. Agent outputs `LOCAL_ACTION: <action_id>`
2. Bridge validates allowlist
3. Bridge calls local relay endpoint
4. Relay executes local task

## 7) Operating model (recommended)

- Use **cloud bridge + MCP registry** for Housecall + estimator + context tools.
- Use **local relay only** for truly local/device tasks.
- Keep Housecall credentials only in cloud secrets, not on local desktop.

## 8) Quick incident checks

1. `/health` fails → bridge runtime/deploy issue.
2. `/mcp` unauthorized → bad `BRIDGE_AUTH_TOKEN` header.
3. `tools/call housecall.get_config` fails → Housecall env var missing.
4. `LOCAL_ACTION` dispatch fails → relay offline or action not allowlisted.
