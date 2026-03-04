# MCP-first upgrade – summary

## What changed

### Phase 1: Foundation and contracts

- **docs/ARCHITECTURE-MCP.md** added. It describes:
  - Bridge as channel gateway (PWA + Telegram)
  - MCP server boundaries (Housecall, catalog, scheduler-context)
  - Async job lifecycle (create → run → poll → TTL)
  - Security (auth, allowlists, idempotency, audit-style logging)
  - Request validation and backward compatibility
  - TODOs for full MCP externalization

- **Request validation** (Zod) was already in place for:
  - `POST /chat`
  - `POST /estimator/changeout-plan`
  - `POST /estimator/estimate`
  - `POST /estimator/export/housecall`
  - `POST /integrations/housecall/request`  
  Invalid bodies return **400** with `error` and `details`.

### Phase 2: Async execution and reliability

- **Async `/chat`**: `async=true` (query or body) returns **202** with `{ job_id, state, status_url, agent_id? }`. Unchanged when `async` is not set.
- **GET /jobs/:jobId**: Returns job state (`pending` | `running` | `completed` | `failed`), `result`, `error`, `status_url`.
- **Job store**: Redis when `REDIS_URL` is set; in-memory fallback for local dev. Job TTL: `BRIDGE_JOB_TTL_SECONDS`.

### Phase 3: Export safety

- **Idempotency** for `POST /estimator/export/housecall`:
  - `Idempotency-Key` header or `idempotency_key` in body
  - Scope: `user_id` + route + key; TTL cache
  - Duplicate request returns original result and does not resend upstream; response includes **X-Idempotency-Replay: true**

### Phase 4: MCP tool migration scaffold

- **bridge/mcp/** added:
  - **housecall-tool.js** — Wraps Housecall: getConfig, housecallRequest, testConnection, listCustomers, resolveAppointmentContext.
  - **catalog-tool.js** — Wraps catalog: getIngestReport, loadCatalog, getItemBySku, queryByAttribute.
  - **scheduler-context-tool.js** — Stub that delegates to Housecall `resolveAppointmentContext`; TODOs for config and caching.
  - **index.js** — Re-exports adapters for server use.

- **Internal routing**: Server now uses MCP adapters for:
  - Housecall config, test, list customers, resolve-context, and raw request
  - Catalog: ingest report and load catalog in `resolveRuntimeEstimatorProfile`
  - Export flow still uses `housecall-mapper` + MCP `housecallRequest` for buildHousecallUpsertPlan and upstream calls.

- **Feature flag**: `ENABLE_HOUSECALL_DEBUG_REQUEST`:
  - `true` or `1`: allow `POST /integrations/housecall/request`
  - Unset or `false`: endpoint returns **403** (default for production)
  - `DISABLE_HOUSECALL_REQUEST=true` still disables the endpoint regardless of `ENABLE_*`.

### Phase 5: Observability and tests

- **Structured logging** (already present): `x-request-id` honored or generated; logs include `request_id`, `user_id`, `agent_id`, route, status, `latency_ms` (no secrets or full bodies).

- **Tests**:
  - **server-integration.test.js** (supertest):
    - GET /health
    - POST /chat with async=true → 202 and job_id
    - GET /jobs/:id → 200 with job / 404 for unknown
    - POST /chat invalid body → 400 with details
    - POST /estimator/export/housecall idempotency → first 200, second 200 with X-Idempotency-Replay
    - POST /integrations/housecall/request without flag → 403
  - Existing unit tests for jobs-store, idempotency-store, validation schemas, and other modules unchanged.

- **Server export**: `server.js` exports `app` and only calls `app.listen()` when run as the main module (`pathToFileURL(resolve(process.argv[1])).href === import.meta.url`), so tests can import `app` without starting the listener.

### README

- **bridge/README.md**: Documented `ENABLE_HOUSECALL_DEBUG_REQUEST`, default-off debug endpoint, and new **MCP adapter layer** section with pointer to **docs/ARCHITECTURE-MCP.md**.

### Phase 6: External MCP server + agent tool wiring

- **bridge/mcp-server/** added:
  - **schemas.js** — Zod input schemas for all 10 tools (housecall.*, catalog.*, scheduler.resolve_context).
  - **tool-runner.js** — `runTool(name, args, options)` validates with Zod, calls `bridge/mcp` adapters, returns `{ ok, result }` or `{ ok: false, error, code, details }`. `listTools()` returns name/description/inputSchema for discovery. **housecall.request** gated by `allowDebugRequest` (same policy as debug HTTP endpoint).
  - **stdio-server.js** — Newline-delimited JSON-RPC 2.0 over stdin/stdout. Handles `initialize`, `tools/list`, `tools/call`. Run with `npm run mcp:stdio`. **Why stdio:** MCP clients (Cursor, IDEs) typically spawn the server and use stdio; no port or auth needed.

- **HTTP tool routes** (when **USE_MCP_TOOLS=true**):
  - **GET /mcp/tools** — List tools (auth required).
  - **POST /mcp/call** — Invoke tool by name with `arguments` (auth + rate limit). Body: `{ tool, arguments }` or `{ name, args }`. Response: same envelope as tool-runner.

- **docs/MCP-TOOLS.md** — Tool discovery: name, args, returns, example payloads for all 10 tools.

- **Security**: MCP HTTP routes use same bridge auth and rate limits. **housecall.request** remains disabled unless `ENABLE_HOUSECALL_DEBUG_REQUEST=true` and not `DISABLE_HOUSECALL_REQUEST`.

- **Feature flag**: **USE_MCP_TOOLS** — `true` or `1` to register `/mcp/tools` and `/mcp/call`. When unset, routes are not registered (404). Backward compat: `/chat`, Telegram, estimator, Housecall export unchanged.

- **Tests**:
  - **test/mcp-tools.test.js** — listTools shape, runTool unknown/validation/TOOL_DISABLED, success paths for housecall.get_config, catalog.get_report, catalog.load, scheduler validation.
  - **server-integration.test.js** — GET /mcp/tools, POST /mcp/call (housecall.get_config, catalog.get_report), missing tool 400, housecall.request TOOL_DISABLED, validation error envelope. (Tests run with USE_MCP_TOOLS=true.)

- **Docs**: README extended with MCP server run instructions, env vars, curl examples. ARCHITECTURE-MCP updated to describe stdio + HTTP and mark Phase 6 done. This summary extended with Phase 6 and updated TODOs/files.

---

## Compatibility notes

- **Sync `/chat`**: Default behavior unchanged; no `async` → same polling response as before.
- **Telegram**: Unchanged; same agent pipeline and reply flow.
- **Housecall export**: Same behavior; idempotency is optional via header/body key.
- **Estimator routes**: Same contracts; validation only adds structured 400s for invalid input.
- **Debug endpoint**: Previously allowed unless `DISABLE_HOUSECALL_REQUEST` was set. Now **disabled by default**; set `ENABLE_HOUSECALL_DEBUG_REQUEST=true` to enable (backward-compat: set this in dev if you rely on the raw proxy).
- **Starting the server**: `npm start` / `node server.js` still starts the HTTP server; only the entry-point check was added so `app` can be imported in tests without binding a port.

---

## Remaining TODOs (post–Phase 6)

1. **Scheduler-context** — Finish `scheduler-context-tool.js`: config (e.g. appointment lookup path), error handling, optional caching by `appointment_id`.

2. **Audit log persistence** — Optionally persist request/response metadata (e.g. Redis or log store) for compliance or debugging beyond stdout.

3. **Agent tool use** — Optionally instruct the agent (or Cursor Cloud Agents) to call MCP tools via `POST /mcp/call` or the stdio server instead of (or in addition to) orchestrator commands like `HOUSECALL_EXPORT`.

---

## Files touched

| Path | Change |
|------|--------|
| docs/ARCHITECTURE-MCP.md | New: architecture, MCP boundaries, async, security |
| bridge/mcp/housecall-tool.js | New: Housecall adapter |
| bridge/mcp/catalog-tool.js | New: Catalog adapter |
| bridge/mcp/scheduler-context-tool.js | New: Scheduler-context stub |
| bridge/mcp/index.js | New: Adapter exports |
| bridge/server.js | MCP imports; routes use adapters; ENABLE_HOUSECALL_DEBUG_REQUEST; USE_MCP_TOOLS; conditional listen; export app |
| bridge/README.md | ENABLE_HOUSECALL_DEBUG_REQUEST; USE_MCP_TOOLS; MCP adapter section; MCP server run, env, curl examples |
| bridge/package.json | mcp:stdio script |
| bridge/mcp-server/schemas.js | New: Zod input schemas for all tools |
| bridge/mcp-server/tool-runner.js | New: runTool, listTools, error envelope |
| bridge/mcp-server/stdio-server.js | New: stdio JSON-RPC MCP server |
| docs/MCP-TOOLS.md | New: tool discovery and examples |
| bridge/test/mcp-tools.test.js | New: tool-runner and listTools tests |
| bridge/test/server-integration.test.js | MCP HTTP tests (GET /mcp/tools, POST /mcp/call, validation, TOOL_DISABLED) |
| docs/ARCHITECTURE-MCP.md | Phase 6: stdio + HTTP, tool runner, updated TODOs |
| bridge/MCP-UPGRADE-SUMMARY.md | This file; Phase 6 section and file list |
