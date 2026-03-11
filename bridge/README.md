# Cursor Agent Bridge

Bridge service that connects Telegram and a simple PWA to an agent provider API. Provider selection is controlled by `AGENT_PROVIDER` (default: `cursor`).

## Prerequisites

- Node.js 18+
- [Doppler CLI](https://docs.doppler.com/docs/install-cli) (recommended) or export env vars manually.
- One provider credential:
  - Cursor: API key from [Cursor Dashboard → Integrations](https://cursor.com/dashboard?tab=integrations).
  - Codex/OpenAI: `OPENAI_API_KEY` for the Responses API.

## Doppler setup (recommended)

Secrets are not always available from the environment (e.g. in CI or when the bridge is started by another process). Use **Doppler** so the bridge gets provider keys, `BRIDGE_AUTH_TOKEN`, etc. reliably.

1. Install Doppler CLI: `doppler setup` (or see [Install CLI](https://docs.doppler.com/docs/install-cli)).
2. Create a project (e.g. `cursor-bridge`) and a config (e.g. `dev`).
3. Add secrets in the Doppler dashboard or via CLI:
   - `AGENT_PROVIDER` — `cursor` (default) or `codex`.
   - `CURSOR_API_KEY` — your Cursor Cloud Agents API key (`key_...`) when `AGENT_PROVIDER=cursor`.
   - `OPENAI_API_KEY` — required when `AGENT_PROVIDER=codex`.
   - `OPENAI_MODEL` / `OPENAI_MODEL_FULL` — optional full model override for codex provider (default `gpt-5`).
   - `OPENAI_MODEL_MINI` — optional mini model override (default `gpt-5-mini`).
   - `OPENAI_MODEL_ROUTING` — `auto` (default), `mini`, or `full`.
   - `OPENAI_BUDGET_MONTHLY_USD` — optional monthly budget cap for codex auto-routing.
   - `OPENAI_BUDGET_FORCE_MINI_THRESHOLD_PCT` — optional threshold ratio to force mini in auto mode (default `1.0`).
   - `OPENAI_PRICE_INPUT_FULL_PER_1M`, `OPENAI_PRICE_OUTPUT_FULL_PER_1M`, `OPENAI_PRICE_INPUT_MINI_PER_1M`, `OPENAI_PRICE_OUTPUT_MINI_PER_1M` — optional cost model overrides for telemetry/budget logic.
   - `OPENAI_API_BASE` — optional API base override (default `https://api.openai.com`).
   - `AGENT_ENV_REPO` — GitHub URL of this repo (e.g. `https://github.com/your-org/cursor-agent-env`).
   - `AGENT_ENV_REF` — optional; branch or ref for the agent repo (e.g. `cursor/hvac-pricing-agent-3304`). When set, new Telegram/PWA agents use this ref; when unset, the Cursor API uses the repo’s default branch (usually `main`). Use this so the agent has the latest docs/memory without merging to main.
   - `BRIDGE_AUTH_TOKEN` — required token for HTTP clients (`/chat`, `/agent/:userId`). Send as `x-bridge-token` or `Authorization: Bearer ...`.
   - `CHATGPT_ACTION_TOKEN` — optional dedicated token for `/chatgpt/*` action routes (`x-chatgpt-token` header). Defaults to `BRIDGE_AUTH_TOKEN` if unset.
   - `SUBAGENT_REPO_ALLOWLIST`, `LOCAL_ACTION_ALLOWLIST`, `LOCAL_ACTION_ENDPOINT`, `LOCAL_ACTION_AUTH_TOKEN` — optional orchestrator settings.
   - `REDIS_URL` — optional Redis for persistent agent mapping, rate limiting, **async job state**, and **idempotency cache**. When unset, in-memory (and file for agent mapping) fallbacks are used.
   - `BRIDGE_CODEX_SESSION_TTL_SECONDS` — optional TTL for persisted codex sessions (default 604800 / 7 days).
   - `TELEGRAM_BOT_TOKEN` — optional; from [@BotFather](https://t.me/BotFather) if you want Telegram.
   - `TELEGRAM_POLLING_ENABLED` — optional; set `false`/`0`/`no` to disable Telegram polling even when `TELEGRAM_BOT_TOKEN` is set (helps avoid 409 polling conflicts on multi-instance deploys).
   - `DISABLE_HOUSECALL_REQUEST` — set to `true` or `1` to disable `POST /integrations/housecall/request` (e.g. in production).
   - `ENABLE_HOUSECALL_DEBUG_REQUEST` — set to `true` or `1` to **allow** the debug proxy `POST /integrations/housecall/request`. When unset (or `false`), the endpoint returns 403. Use with `DISABLE_HOUSECALL_REQUEST` unset.
   - `USE_MCP_TOOLS` — set to `true` or `1` to enable **GET /mcp/tools**, **POST /mcp/call**, and **POST /mcp** (JSON-RPC) for MCP-style tool discovery and invocation. When unset, these routes are not registered.
   - `GDRIVE_SERVICE_ACCOUNT_JSON` — optional full Google service-account JSON (single env var form).
   - `GDRIVE_CLIENT_EMAIL`, `GDRIVE_PRIVATE_KEY` — optional service-account field form.
   - `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REFRESH_TOKEN` — optional OAuth refresh flow.
   - `GDRIVE_ACCESS_TOKEN` — optional direct access token mode.
   - `GDRIVE_FOLDER_ID`, `GDRIVE_SHARED_DRIVE_ID`, `GDRIVE_USE_SHARED_DRIVE`, `GDRIVE_SCOPES` — optional defaults for Drive operations.
   - `GDRIVE_MAX_DOWNLOAD_BYTES` — optional download safety cap in bytes (default 10485760 / 10MB).
   - Housecall/estimator vars as needed — see [docs/DOPPLER.md](../docs/DOPPLER.md).
4. Run the bridge with Doppler injecting env vars:
   ```bash
   doppler run -- node server.js
   ```
   Or: `doppler run -- npm start`.

**Optional fallback:** If you have a local `bridge/.env` (gitignored), the bridge loads it on startup. You can use that instead of Doppler when running locally and you control the file. Never commit `.env` or API keys.

## Install and run

```bash
cd bridge
npm install
doppler run -- npm start
```

(Or `npm run dev` if you use `doppler run -- npm run dev` or have `bridge/.env` in place.)

Default port: 3000. Set `PORT` to change it.

## Quick start: Telegram only

To use the bridge only as a Telegram bot (no PWA/HTTP needed for chat):

1. **Create a bot** in Telegram: open [@BotFather](https://t.me/BotFather), send `/newbot`, follow the prompts, and copy the token (e.g. `7123456789:AAH...`).
2. **Set env vars** (Doppler or `bridge/.env`):
   - `AGENT_PROVIDER` — `cursor` (default) or `codex`.
   - `CURSOR_API_KEY` — required when `AGENT_PROVIDER=cursor` (from [Cursor Dashboard → Integrations](https://cursor.com/dashboard?tab=integrations)).
   - `OPENAI_API_KEY` — required when `AGENT_PROVIDER=codex`.
   - `AGENT_ENV_REPO` — your repo URL (e.g. `https://github.com/blake7ferrin/cursor-agent-env`); otherwise the API may return Bad Request.
   - `AGENT_ENV_REF` — optional; set to your feature branch (e.g. `cursor/hvac-pricing-agent-3304`) so the Telegram agent uses that branch’s MEMORY.md, docs, and skills (e.g. Housecall/MCP). Otherwise the agent uses the repo’s default branch.
   - `TELEGRAM_BOT_TOKEN` — the token from BotFather.
   - `BRIDGE_AUTH_TOKEN` — required by the server but only for HTTP endpoints; set any secret string if you still want to call `/chat` or `/health` from scripts.
3. **Run the bridge** from `bridge/`:
   ```bash
   doppler run -- npm run dev
   ```
   Or with a local `.env`: `npm run dev`.
4. **Chat** with your bot in Telegram. Each chat gets a persistent agent (`user_id = telegram:<chatId>`). Replies are sent back when the agent finishes (or "Agent still running." if it’s taking longer than the poll window).

Codex routing behavior:
- In `auto`, launch prompts route to `OPENAI_MODEL_MINI` by default and escalate to full for complex engineering prompts (refactor/architecture/multi-file/root-cause style requests).
- In `auto`, budget policy can force mini when current month spend reaches `OPENAI_BUDGET_MONTHLY_USD * OPENAI_BUDGET_FORCE_MINI_THRESHOLD_PCT`.
- Follow-ups stay on the same model selected at launch for response-chain compatibility and predictable costs.

The bot uses long-polling; no webhook or public URL is required.

**Getting the Telegram agent Housecall/MCP context:** The agent loads the repo from the branch chosen by the Cursor API (default branch when `AGENT_ENV_REF` is unset, usually `main`). To use your latest MEMORY.md, docs (e.g. HOUSECALL-AGENT.md, MCP-TOOLS.md), and skills: **(1)** Set `AGENT_ENV_REF` to your branch (e.g. `cursor/hvac-pricing-agent-3304`) in Doppler or `.env`, then restart the bridge — new chats (and new agents) will use that branch. **(2)** Or merge your feature branch into `main` and push so the default branch has the updates; then restart the bridge so new agents pick up the new main.

## Endpoints

- `GET /health` — Health check.
- `POST /chat` — Send a message to the agent. Body: `{ "user_id": "required-id", "message": "your text" }`. Requires auth token. **Sync (default):** Returns `{ reply, agent_id, state, parsed, dispatched }` when the agent has finished (or a partial reply on timeout). **Async:** Add `?async=true` or `"async": true` in body to get `202 Accepted` with `job_id`, `status_url`; poll `GET /jobs/:id` for status and result.
- `GET /jobs/:id` — Get async chat job status and result. Requires auth token. Returns `{ job_id, agent_id, user_id, status, result, error, created_at, status_url }`. Use after `POST /chat` with `async=true`.
- `GET /agent/:userId` — Get stored `agent_id` for a user (if any). Requires auth token.
- `GET /usage/codex` — Get codex monthly usage summary (requests, token totals, estimated USD cost). Optional query: `month=YYYY-MM`.
- `GET /chatgpt/openapi.json` — OpenAPI schema for Custom GPT Actions import.
- `GET /chatgpt/health` — ChatGPT action route health check (requires `x-chatgpt-token`).
- `POST /chatgpt/chat` — ChatGPT action chat endpoint. Body: `{ "session_id": "...", "message": "...", "async": true|false }`.
- `GET /chatgpt/jobs/:id` — Poll async chat jobs started via `/chatgpt/chat`.
- `GET /chatgpt/usage/codex` — Codex usage summary for action clients.
- `GET /chatgpt/gdrive/config` — Google Drive config summary for action clients.
- `POST /ingest` — Run HVAC catalog import from `bridge/imports/incoming/`. Requires auth token. Returns validation report. Optional body/query: `profile=preferred|canonical_csv_only` and/or `only=...`. See `imports/README.md`.
- `GET /` — Simple PWA chat UI (served from `public/`).
- `PUT /estimator/config` — Save pricing assumptions for one user. Body: `{ "user_id": "...", "config": { ... } }`.
- `PUT /estimator/catalog` — Save/replace parts + equipment catalog. Body: `{ "user_id": "...", "items": [ ... ] }`.
- `GET /estimator/profile` — Read current estimator config + catalog (`user_id` query param or `x-user-id` header).
- `POST /estimator/changeout-plan` — Intake-driven residential changeout planner (lane classification + questions + recommended options + optional estimate preview). By default, it auto-loads the ingested `preferred` profile catalog at runtime. Request bodies are validated; invalid payloads return `400` with `error` and `details`.
- `POST /estimator/estimate` — Generate deterministic estimate totals and printable HTML. Auto-loads ingested `preferred` profile catalog by default (same runtime options as `changeout-plan`). Body: `{ "user_id": "...", "selections": [ ... ], "manual_items": [ ... ], "customer": { ... }, "project": { ... }, "adjustments": { ... }, "output": "json|html" }`. Validated; invalid payloads return `400` with field-level details.
- `POST /estimator/export/housecall` — Build and send estimate to Housecall Pro. Supports dry-run and payload override. **Idempotency:** Send `Idempotency-Key` header or `idempotency_key` in body to avoid duplicate sends; repeated requests with the same key return the stored response with `X-Idempotency-Replay: true`.
- `GET /integrations/housecall/config` — Returns Housecall auth mode summary (no secrets).
- `GET /integrations/gdrive/config` — Returns Google Drive auth/config summary (no secrets).
- `GET /integrations/gdrive/files` — List files using Drive query params (`q`, `page_size`, `page_token`, `folder_id`, `shared_drive_id`, `order_by`, `fields`).
- `POST /integrations/gdrive/upload` — Upload base64 file payload. Body: `{ "name": "...", "content_base64": "...", "mime_type": "...", "folder_id": "...", "shared_drive_id": "..." }`.
- `GET /integrations/gdrive/download/:fileId` — Download file content as base64 JSON (`content_base64`, `mime_type`, `size`).
- `GET /integrations/housecall/customers` — List/search Housecall customers (query: `search`, `page_size`, `page`). Use to find existing customer IDs.
- `POST /integrations/housecall/test` — Runs a lightweight authenticated test call to Housecall.
- `POST /integrations/housecall/request` — Debug endpoint for direct Housecall API calls. **Disabled by default**; set `ENABLE_HOUSECALL_DEBUG_REQUEST=true` to enable (and ensure `DISABLE_HOUSECALL_REQUEST` is not set).
- `POST /integrations/housecall/resolve-context` — Lookup appointment context and extract linked IDs (job/estimate/option).

## Production hardening

### Async chat jobs

For long-running agent work, use **async mode** so the HTTP client does not block:

```bash
# Start async job (returns immediately with 202)
curl -X POST "http://localhost:3000/chat?async=true" \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{"user_id": "pwa:me", "message": "Summarize MEMORY.md"}'
# Response: {"job_id":"...","agent_id":null,"status":"pending","status_url":"http://..."}

# Poll for status and result
curl "http://localhost:3000/jobs/JOB_ID" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN"
# Response: {"job_id":"...","agent_id":"...","user_id":"...","status":"completed","result":{...},"status_url":"..."}
```

Optional env: `BRIDGE_PUBLIC_URL` (e.g. `https://bridge.example.com`) so `status_url` uses a public base. Job TTL: `BRIDGE_JOB_TTL_SECONDS` (default 86400).

### Request validation

`POST /chat`, `/estimator/changeout-plan`, `/estimator/estimate`, `/estimator/export/housecall`, and `POST /integrations/housecall/request` validate request bodies. Invalid payloads return **400** with `{ "error": "...", "details": [ { "path": ["field"], "message": "..." } ] }`.

### Idempotency (Housecall export)

To avoid double-sending the same estimate, send an idempotency key:

```bash
curl -X POST http://localhost:3000/estimator/export/housecall \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -H "Idempotency-Key: my-export-request-123" \
  -d '{"user_id": "pwa:me", "customer": {"name": "Jane"}, "selections": [...]}'
```

Repeat the same request with the same key; the bridge returns the **original response** with header `X-Idempotency-Replay: true`. Keys are scoped per user and route, with a 24h TTL (`BRIDGE_IDEMPOTENCY_TTL_SECONDS`). With `REDIS_URL` set, idempotency state is shared across instances.

### Logging and correlation

- Every request gets a **correlation ID**: use header `x-request-id` (or one is generated). The response echoes it.
- Logs are structured JSON lines: `request_id`, `user_id`, `agent_id` (when set), `route`, `method`, `status`, `latency_ms`. Secrets and full bodies are not logged.

### Security

- Set `DISABLE_HOUSECALL_REQUEST=true` in production to turn off the debug proxy `POST /integrations/housecall/request`. Alternatively, leave `ENABLE_HOUSECALL_DEBUG_REQUEST` unset (default) so the endpoint returns 403 until explicitly enabled.
- Auth (`x-bridge-token` or `Authorization: Bearer`) and rate limits apply to all sensitive routes. Orchestrator dispatch remains allowlist-only (`SUBAGENT_REPO_ALLOWLIST`, `LOCAL_ACTION_ALLOWLIST`).

### Compatibility and migration

- **Default behavior is unchanged:** `POST /chat` without `async=true` is still synchronous. Existing clients do not need to change.
- **Validation:** Clients that sent invalid payloads (e.g. missing `user_id` or `message`) previously got a generic 400; they now get the same 400 with structured `details`. Ensure required fields are sent.
- **Idempotency** is optional; omit the key for current behavior.
- **Redis:** When `REDIS_URL` is set, agent mapping, rate limits, async jobs, and idempotency use Redis. Without it, in-memory (and file for agents) is used as before.

## MCP adapter layer

The bridge exposes an **MCP adapter layer** under `bridge/mcp/` so Housecall, catalog, and scheduler-context operations go through a single tool-friendly API. HTTP routes call these adapters; a future MCP server can expose the same capabilities as tools. See **docs/ARCHITECTURE-MCP.md** for the full architecture (channel gateway, MCP boundaries, async job lifecycle, security, and TODOs for full MCP externalization).

- **housecall-tool.js** — config, raw request, test connection, list customers, resolve appointment context.
- **catalog-tool.js** — ingest report, load catalog by profile, get item by SKU, query by attribute.
- **scheduler-context-tool.js** — resolve appointment → job/estimate/option context (stub delegates to Housecall).

## MCP server (Phase 6)

When **USE_MCP_TOOLS=true**, the bridge exposes tool-call endpoints and you can run a standalone MCP server over stdio for Cursor/IDE integration.

### Stdio MCP server

Run the MCP server so a client (e.g. Cursor) can spawn it and talk JSON-RPC over stdin/stdout:

```bash
cd bridge
npm run mcp:stdio
```

Or directly: `node mcp-server/stdio-server.js`. The process reads newline-delimited JSON-RPC from stdin and writes responses to stdout; logs go to stderr. Env vars (e.g. from Doppler or `.env`) are loaded from `bridge/.env`. **Why stdio:** MCP clients typically spawn the server as a subprocess and use stdio for transport; no port or auth is needed and the parent enforces isolation.

Supported JSON-RPC methods:

- **initialize** — Returns protocol version and capabilities.
- **tools/list** — Returns the list of tools (housecall.*, catalog.*, scheduler.*).
- **tools/call** — Executes a tool by name with `arguments`; returns `content` (text JSON) and `isError`.

### HTTP tool endpoints (when USE_MCP_TOOLS=true)

- **GET /mcp/tools** — List tools (auth required). Response: `{ tools: [ { name, description, inputSchema }, ... ] }`.
- **POST /mcp/call** — Call a tool (auth required). Body: `{ "tool": "housecall.get_config", "arguments": {} }`. Response: `{ ok: true, result }` or `{ ok: false, error, code, details? }`.
- **POST /mcp** — MCP Registry-friendly JSON-RPC endpoint (auth + rate limit). Supports `initialize`, `tools/list`, and `tools/call`.

Example:

```bash
export BRIDGE_AUTH_TOKEN=your-token
curl -s -H "Authorization: Bearer $BRIDGE_AUTH_TOKEN" http://localhost:3000/mcp/tools
curl -s -X POST http://localhost:3000/mcp/call \
  -H "Authorization: Bearer $BRIDGE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"catalog.get_report","arguments":{}}'
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $BRIDGE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Tool reference (names, arguments, return shapes): **docs/MCP-TOOLS.md**.
Cloud deployment/runbook for MCP registry + optional local relay: **docs/CLOUD-MCP-HYBRID-SETUP.md**.

### Security

- MCP HTTP routes use the same bridge auth (`x-bridge-token` or `Authorization: Bearer`) and rate limiting as other sensitive routes.
- **housecall.request** is disabled unless **ENABLE_HOUSECALL_DEBUG_REQUEST=true** and **DISABLE_HOUSECALL_REQUEST** is not set (same policy as `POST /integrations/housecall/request`).

### Feature flag

- **USE_MCP_TOOLS** — Set to `true` or `1` to register **GET /mcp/tools**, **POST /mcp/call**, and **POST /mcp**. When unset, these routes are not registered (404). Existing `/chat`, Telegram, estimator, and Housecall export flows are unchanged.

### Google Drive config (phase 1)

The bridge now exposes config and file operations for Google Drive:

- **HTTP:** `GET /integrations/gdrive/config`
- **HTTP:** `GET /integrations/gdrive/files`, `POST /integrations/gdrive/upload`, `GET /integrations/gdrive/download/:fileId`
- **MCP tools:** `gdrive.get_config`, `gdrive.list_files`, `gdrive.upload_file`, `gdrive.download_file`

These routes/tools report auth readiness and support list/upload/download flows for remote file transfer.

## HVAC estimator MVP

The bridge now includes a first-pass HVAC estimator with:

- Deterministic pricing math (not freeform LLM arithmetic)
- Configurable labor burden, overhead, and target gross margin
- Optional minimum-margin guardrail (`minimumGrossMargin`, `enforceMinimumGrossMargin`)
- Stored catalog items (equipment/parts/services) per `user_id`
- Estimate output as JSON and print-ready HTML (can be saved as PDF in browser)

### Example: set pricing config

```bash
curl -X PUT http://localhost:3000/estimator/config \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
    "config": {
      "businessName": "Blake HVAC",
      "laborRatePerHour": 95,
      "laborBurdenRate": 0.32,
      "overheadRate": 0.18,
      "targetGrossMargin": 0.5,
      "defaultTaxRate": 0.07
    }
  }'
```

### Example: upload catalog

```bash
curl -X PUT http://localhost:3000/estimator/catalog \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
    "items": [
      {
        "sku": "HP-3T-16",
        "name": "3 Ton 16 SEER2 Heat Pump",
        "itemType": "equipment",
        "unitCost": 3200,
        "defaultLaborHours": 6,
        "features": ["Variable speed air handler compatible", "10 year compressor warranty"],
        "taxable": true
      }
    ]
  }'
```

Catalog items can include optional `attributes` for smarter intake matching:

```json
{
  "sku": "ACPRO-HP-4T-18",
  "name": "AC Pro 4 Ton Split Heat Pump 18 SEER2",
  "itemType": "equipment",
  "unitCost": 4200,
  "defaultLaborHours": 7,
  "attributes": {
    "brand": "AC Pro",
    "tonnage": 4,
    "seer2": 18,
    "systemType": "split_heat_pump",
    "phase": "single",
    "vendorContact": "AC Pro Counter (555-100-2000)"
  }
}
```

### Example: run residential changeout intake plan

```bash
curl -X POST http://localhost:3000/estimator/changeout-plan \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
    "catalog_profile": "preferred",
    "use_imported_catalog": true,
    "include_user_catalog": true,
    "customer": { "name": "Jane Smith" },
    "project": { "summary": "Replace split heat pump system" },
    "intake": {
      "requestedBrand": "AC Pro",
      "tonnage": 4,
      "systemType": "split_heat_pump",
      "phase": "single",
      "selectedEquipmentSku": "ACPRO-HP-4T-18",
      "installConditions": {
        "tightAttic": true
      }
    }
  }'
```

`changeout-plan` returns:
- `lane` (`auto_ready`, `needs_selection`, `needs_questions`, `awaiting_vendor_quote`, `manual_review`)
- `follow_up_questions`
- `recommended_options`
- `complexity_adders`
- `complexity_adders_resolution` (`catalog` vs `fallback` per edge-case adder)
- `draft_estimate_request` + `estimate_preview` when ready
- `catalog_runtime` (which profile was loaded/refreshed and effective catalog counts)

### Example: generate estimate

```bash
curl -X POST http://localhost:3000/estimator/estimate \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
    "catalog_profile": "preferred",
    "use_imported_catalog": true,
    "include_user_catalog": true,
    "customer": { "name": "Jane Smith" },
    "project": { "summary": "Replace upstairs heat pump system" },
    "selections": [
      { "sku": "HP-3T-16", "quantity": 1 }
    ],
    "adjustments": {
      "permitFee": 250,
      "tripCharge": 89,
      "discountPercent": 0.05
    }
  }'
```

For JSON output, response now includes `catalog_runtime` metadata to show which catalog profile was used and whether ingest refresh occurred.

## Housecall Pro export

The bridge now supports exporting generated estimates to Housecall Pro.

If you pass `selections`/`manual_items` (instead of a prebuilt `estimate` object), export uses the same runtime catalog options as `/estimator/estimate`:
`catalog_profile`, `use_imported_catalog`, `include_user_catalog`, `refresh_import_catalog`.

### 1) Confirm connector config

```bash
curl http://localhost:3000/integrations/housecall/config \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN"
```

### 2) Test Housecall auth

```bash
curl -X POST http://localhost:3000/integrations/housecall/test \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{}'
```

### 3) Dry-run export payload (recommended first)

```bash
curl -X POST http://localhost:3000/estimator/export/housecall \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
    "customer": { "name": "Jane Smith", "housecall_customer_id": "cust_123" },
    "project": { "summary": "Replace upstairs heat pump", "housecall_job_id": "job_456" },
    "selections": [{ "sku": "HP-3T-16", "quantity": 1 }],
    "housecall": { "dry_run": true }
  }'
```

### 4) Live export to Housecall

```bash
curl -X POST http://localhost:3000/estimator/export/housecall \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
    "customer": { "name": "Jane Smith", "housecall_customer_id": "cust_123" },
    "project": { "summary": "Replace upstairs heat pump", "housecall_job_id": "job_456" },
    "selections": [{ "sku": "HP-3T-16", "quantity": 1 }]
  }'
```

### 5) Update an existing estimate (already scheduled / already created)

```bash
curl -X POST http://localhost:3000/estimator/export/housecall \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
    "customer": { "name": "Jane Smith", "housecall_customer_id": "cust_123" },
    "project": { "summary": "Replace upstairs heat pump", "housecall_estimate_id": "est_789" },
    "selections": [{ "sku": "HP-3T-16", "quantity": 1 }],
    "housecall": {
      "mode": "update_estimate",
      "estimate_id": "est_789",
      "dry_run": true
    }
  }'
```

### 6) Add a new estimate onto an existing job

```bash
curl -X POST http://localhost:3000/estimator/export/housecall \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
    "customer": { "name": "Jane Smith", "housecall_customer_id": "cust_123" },
    "project": { "summary": "Add zoning upgrade option", "housecall_job_id": "job_456" },
    "selections": [{ "sku": "HP-3T-16", "quantity": 1 }],
    "housecall": {
      "mode": "add_to_job",
      "job_id": "job_456",
      "dry_run": true
    }
  }'
```

### 6b) Auto-upsert target (recommended default)

If your team only knows partial context, the export route now defaults to an **auto-upsert strategy**:

1. Try `update_estimate` when an `estimate_id` is available
2. If no estimate id, try appointment context resolution (when appointment lookup path is configured)
3. If a `job_id` exists, try `add_to_job`
4. Fallback to `create_estimate`

On live export, the bridge automatically falls through to the next step only for "not found" style failures.

```bash
curl -X POST http://localhost:3000/estimator/export/housecall \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
    "customer": { "name": "Jane Smith", "housecall_customer_id": "cust_123" },
    "project": { "summary": "Finalize scope after field inspection" },
    "selections": [{ "sku": "HP-3T-16", "quantity": 1 }],
    "housecall": {
      "auto_upsert": true,
      "appointment_id": "apt_123",
      "resolve_context": true,
      "appointment_lookup_path": "/schedule/{appointment_id}",
      "dry_run": true
    }
  }'
```

### 7) Resolve context from an appointment before export

```bash
curl -X POST http://localhost:3000/integrations/housecall/resolve-context \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "appointment_id": "apt_123",
    "appointment_lookup_path": "/schedule/{appointment_id}"
  }'
```

You can also do this inside export by providing:

```json
{
  "housecall": {
    "appointment_id": "apt_123",
    "resolve_context": true,
    "appointment_lookup_path": "/schedule/{appointment_id}"
  }
}
```

### Notes on payload mapping

- **Existing customer:** If you do not pass `housecall_customer_id` (or `customer_id`) in the customer object, the bridge looks up Housecall customers by name, email, or phone and uses the first match so the estimate links to an existing customer instead of creating a new one. Pass `customer: { name: "..." }` (and email/phone when available) for best matching.
- `POST /estimator/export/housecall` creates a best-effort payload from the estimator output.
- If your Housecall account expects a different schema, use:
  - `housecall.endpoint` to override the path
  - `housecall.payload_override` to send your exact JSON body
- Supported `housecall.mode` values:
  - `auto_upsert` (default if no explicit mode)
  - `create_estimate` (always create new estimate)
  - `add_to_job` (requires `job_id`)
  - `update_estimate` (requires `estimate_id`)
  - `add_option_note` (requires `estimate_id` + `estimate_option_id`)
- This lets you move forward immediately while we tune field mapping to your exact Housecall API contract.

## E2E estimator API test

To verify the estimator really works over HTTP (catalog load, changeout-plan, estimate, Housecall dry-run):

1. **Start the bridge** in one terminal (use Doppler so secrets are available):
   ```bash
   cd bridge && doppler run -- npm run dev
   ```
2. **Ensure the imported catalog exists** (otherwise changeout-plan will have no options):
   ```bash
   cd bridge && npm run ingest -- --profile preferred
   ```
3. **Run the E2E script** from another terminal:
   ```bash
   cd bridge
   set BRIDGE_AUTH_TOKEN=your-token
   npm run test:e2e
   ```
   (Or run under Doppler: `doppler run -- npm run test:e2e` so the token is injected.)

   Optional: `BASE_URL` (default `http://localhost:3000`), `USER_ID` (default `e2e-test-user`).

The script calls: `GET /health`, `GET /estimator/profile`, `POST /estimator/changeout-plan`, `POST /estimator/estimate` (JSON then HTML), and `POST /estimator/export/housecall` with `housecall.dry_run: true`. It writes a sample HTML estimate to `bridge/scripts/e2e-estimate-output.html`. If any step fails, the summary at the end reports what’s missing (e.g. run ingest, or start the bridge).

## Telegram

If `TELEGRAM_BOT_TOKEN` is set, the bridge starts a Telegram bot and forwards every message to the same agent (user id = `telegram:<chatId>`). Replies are sent back to the chat after the agent completes.

## Orchestrator protocol

When the agent outputs lines like `SUBAGENT: repo=..., prompt=...` or `LOCAL_ACTION: action_id`, the bridge parses and executes them if allowlists permit, then returns both `parsed` and `dispatched` on `/chat`. See `docs/orchestrator-protocol.md` in the repo root.

## Rate limits

The bridge retries on Cursor API 429 with a delay. HTTP `/chat` rate limiting is enforced per user. With `REDIS_URL`, limits persist across restarts and scale across bridge instances. Without Redis, in-memory limits are used. Polling is every 15s by default; tune in `server.js` if needed.
