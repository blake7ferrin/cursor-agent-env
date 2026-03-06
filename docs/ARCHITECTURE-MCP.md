# Bridge architecture: MCP-first AI control center

This document describes the bridge’s role as a **channel gateway** and **tool layer** for an AI control center, with MCP (Model Context Protocol) server boundaries, async execution, and security.

## Overview

- **Root repo:** Agent environment (this repository). The agent has memory, skills, and orchestrator protocol.
- **Bridge (`bridge/`):** Node.js service that:
  - **Channels:** Accepts input from PWA (HTTP) and Telegram, forwards to the Cursor Cloud Agents API.
  - **Tools:** Exposes and wraps Housecall Pro, catalog/pricebook, and scheduling/context via an MCP adapter layer so the agent (or future MCP clients) can call them in a consistent way.
  - **Deterministic math:** Keeps estimator logic (changeout plan, estimate totals, margin) in the backend; channels and tools only send/receive structured payloads.
  - **Safety:** Auth, allowlists, idempotency, and structured logging make execution observable and safe for production.

## Channel gateway

The bridge is the **single gateway** for remote channels:

| Channel   | Transport        | User identity        | Flow                          |
|----------|-------------------|----------------------|-------------------------------|
| PWA      | HTTP `POST /chat` | `user_id` in body    | Sync or async job; poll `/jobs/:id` |
| Telegram | Long-polling bot  | `user_id = telegram:<chatId>` | Same agent pipeline; reply sent to chat |

- All channel traffic is authenticated (`x-bridge-token` or `Authorization: Bearer`).
- Rate limits apply per `user_id` (Redis or in-memory).
- Sync is default; async is opt-in via `async=true` (query or body) for long-running agent work.

## MCP server boundaries

The bridge runs an **MCP adapter layer** under `bridge/mcp/` and, when **USE_MCP_TOOLS=true**, exposes:

1. **HTTP tool routes** — `GET /mcp/tools` (list) and `POST /mcp/call` (invoke). Same auth and rate limits as other sensitive routes.
2. **Remote JSON-RPC route** — `POST /mcp` for MCP Registry-compatible JSON-RPC (`initialize`, `tools/list`, `tools/call`) over HTTPS with bridge auth.
3. **Stdio MCP server** — `bridge/mcp-server/stdio-server.js` (run with `npm run mcp:stdio`). Serves the same tools over newline-delimited JSON-RPC on stdin/stdout for clients (e.g. Cursor) that spawn the process.

The adapters:

1. **Wrap existing capabilities** (Housecall, catalog, scheduler context) behind a stable, tool-friendly API.
2. **Keep current HTTP routes working**; internal calls go through these adapters so behavior is consistent and testable.
3. **Tool runner** (`bridge/mcp-server/tool-runner.js`) validates input with Zod, calls adapters, and returns a consistent envelope (`{ ok, result }` or `{ ok: false, error, code, details }`). **housecall.request** is gated by the same debug-flag policy as `POST /integrations/housecall/request`.

Tool discovery and usage are documented in **docs/MCP-TOOLS.md**.

| Adapter                  | Role                         | Backing implementation        |
|--------------------------|------------------------------|--------------------------------|
| **Housecall**            | CRM/estimate export, customers, test, raw request | `housecall-pro.js`, `housecall-mapper.js` |
| **Catalog**              | Read/query ingested pricebook (equipment, adders) | `imports/catalog-adapter.js`   |
| **Scheduler / context**  | Appointment → job/estimate context (resolve-context) | `housecall-mapper.js` + Housecall API |

Deterministic estimator math (changeout plan, estimate totals, margin guardrails) stays in `estimator-changeout.js`, `estimator-engine.js`, and related modules; they are **not** MCP tools themselves but are used by the bridge when handling `/estimator/*` and export.

## Async job lifecycle

1. **Create:** Client sends `POST /chat` with `async=true`. Bridge creates a job (Redis or in-memory), returns `202` with `job_id`, `status_url`, and optional `agent_id` (when known).
2. **Run:** Bridge processes the chat in the background: send to agent, wait for completion, run orchestrator dispatch (e.g. Housecall export), update job with result or error.
3. **Poll:** Client calls `GET /jobs/:jobId` to get `status` (`queued` | `running` | `completed` | `failed` | `expired`) and `result` or `error`.
4. **TTL:** Jobs expire after `BRIDGE_JOB_TTL_SECONDS` (default 24h). Expired jobs return 404 or an expired state.

State is stored in Redis when `REDIS_URL` is set; otherwise in-memory (lost on restart).

## Security model

- **Auth:** Every sensitive route requires a valid bridge token (`BRIDGE_AUTH_TOKEN`). Telegram uses the same agent pipeline but does not send this token; the bot is trusted once `TELEGRAM_BOT_TOKEN` is configured.
- **Allowlists:** Orchestrator actions (e.g. `SUBAGENT`, `LOCAL_ACTION`, `HOUSECALL_EXPORT`) are allowlist-driven (`SUBAGENT_REPO_ALLOWLIST`, `LOCAL_ACTION_ALLOWLIST`). No arbitrary repo or action execution.
- **Idempotency:** `POST /estimator/export/housecall` accepts `Idempotency-Key` (header or body). Keys are scoped by `user_id` + route and cached with TTL. A duplicate request returns the **original response** and does not resend upstream (prevents double-send to Housecall).
- **Debug proxy:** The raw Housecall debug endpoint `POST /integrations/housecall/request` can be disabled in production via `DISABLE_HOUSECALL_REQUEST=true` or by not setting `ENABLE_HOUSECALL_DEBUG_REQUEST=true`. Default is disabled for production.
- **Audit / observability:** Structured logs include `request_id` (from `x-request-id` or generated), `user_id`, `agent_id`, route, HTTP status, and `latency_ms`. No secrets or full request/response bodies are logged. Failed requests (5xx) are logged at error level.

## Request validation

Request bodies are validated with a schema layer (Zod) for:

- `POST /chat`
- `POST /estimator/changeout-plan`
- `POST /estimator/estimate`
- `POST /estimator/export/housecall`
- `POST /integrations/housecall/request`

Invalid payloads return `400` with `{ "error": "...", "details": [ { "path": [...], "message": "..." } ] }`.

## Backward compatibility

- Sync `POST /chat` (no `async=true`) is unchanged.
- Telegram flow is unchanged.
- Existing Housecall export behavior (dry-run, modes, auto-upsert) is unchanged; idempotency is additive.
- Estimator and catalog behavior are unchanged; the MCP adapters wrap existing code paths.

## Remaining TODOs (post–Phase 6)

- **Scheduler-context implementation:** Complete `scheduler-context-tool.js` (e.g. appointment lookup path configuration, error handling, and optional caching).
- **Audit log persistence:** Optionally persist request/response metadata (e.g. to Redis or a log store) for compliance or debugging beyond process stdout.
- **Agent tool wiring:** Optionally instruct the agent (or Cursor Cloud Agent) to call MCP tools via `POST /mcp/call` or the stdio server instead of (or in addition to) orchestrator lines like `HOUSECALL_EXPORT`.
