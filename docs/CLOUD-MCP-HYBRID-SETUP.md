# Cloud MCP Hybrid Setup

This is the recommended production setup for:

- Cloud-hosted bridge (always-on)
- Cursor MCP Registry remote server
- Optional local relay for PC-only actions (`LOCAL_ACTION`)

## Required secrets

Set these in your bridge runtime (Doppler, Render, Railway, Fly.io, etc.):

- `CURSOR_API_KEY`
- `BRIDGE_AUTH_TOKEN`
- `AGENT_ENV_REPO`
- `USE_MCP_TOOLS=true`
- `HCP_API_KEY` or `HOUSECALL_PRO_API_KEY`

Optional but recommended:

- `REDIS_URL` (shared job/idempotency/rate-limit state)
- `AGENT_ENV_REF` (pin agent repo branch/ref)
- `BRIDGE_PUBLIC_URL` (correct async status URLs)
- `LOCAL_ACTION_ENDPOINT`, `LOCAL_ACTION_AUTH_TOKEN`, `LOCAL_ACTION_ALLOWLIST` (if using local relay)

## Deploy bridge

```bash
cd bridge
npm install
npm start
```

Health check:

```bash
curl -s https://<your-bridge-domain>/health
```

Expected:

```json
{"ok":true}
```

## Validate MCP registry endpoint

From any machine:

```bash
BASE_URL=https://<your-bridge-domain> BRIDGE_AUTH_TOKEN=<token> npm run test:mcp-registry --prefix bridge
```

This checks:

- `initialize`
- `tools/list`
- `tools/call`

## Configure Cursor MCP Registry

Add a remote MCP server in Cursor:

- URL: `https://<your-bridge-domain>/mcp`
- Header: `Authorization: Bearer <BRIDGE_AUTH_TOKEN>`

The bridge handles JSON-RPC methods:

- `initialize`
- `tools/list`
- `tools/call`

## Optional local relay

Use this only for machine-local actions that should run on your PC.

Bridge env:

- `LOCAL_ACTION_ENDPOINT`
- `LOCAL_ACTION_AUTH_TOKEN`
- `LOCAL_ACTION_ALLOWLIST`

Keep local actions strictly allowlisted.

## Quick troubleshooting

- `401 Unauthorized`:
  - Verify `Authorization: Bearer <BRIDGE_AUTH_TOKEN>` header.
- `404 /mcp`:
  - Ensure `USE_MCP_TOOLS=true` and restart bridge.
- `Bad Request` from Cursor API:
  - Verify `AGENT_ENV_REPO` is a real GitHub URL for this repo.
- Long-running chats:
  - Prefer `POST /chat?async=true` and poll `GET /jobs/:id`.
