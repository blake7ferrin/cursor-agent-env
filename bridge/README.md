# Cursor Agent Bridge

Bridge service that connects Telegram and a simple PWA to the Cursor Cloud Agents API. The agent runs on the **agent-env** repo (this repository); the bridge holds the API key and forwards messages.

## Prerequisites

- Node.js 18+
- [Doppler CLI](https://docs.doppler.com/docs/install-cli) (recommended) or export env vars manually.
- Cursor API key from [Cursor Dashboard → Integrations](https://cursor.com/dashboard?tab=integrations).

## Doppler setup

1. Install Doppler CLI: `doppler setup` (or see [Install CLI](https://docs.doppler.com/docs/install-cli)).
2. Create a project (e.g. `cursor-bridge`) and a config (e.g. `dev`).
3. Add secrets in the Doppler dashboard or via CLI:
   - `CURSOR_API_KEY` — your Cursor Cloud Agents API key (`key_...`).
   - `AGENT_ENV_REPO` — GitHub URL of this agent-env repo (e.g. `https://github.com/your-org/cursor-agent-env`).
   - `BRIDGE_AUTH_TOKEN` — required token for HTTP clients (`/chat`, `/agent/:userId`). Send as `x-bridge-token` or `Authorization: Bearer ...`.
   - `SUBAGENT_REPO_ALLOWLIST` — comma-separated repo URLs/domains allowed for `SUBAGENT:` launches.
   - `LOCAL_ACTION_ALLOWLIST` — comma-separated action IDs allowed for `LOCAL_ACTION:`.
   - `LOCAL_ACTION_ENDPOINT` — local relay endpoint to execute local actions (optional unless using `LOCAL_ACTION`).
   - `LOCAL_ACTION_AUTH_TOKEN` — optional bearer token for the local relay.
   - `REDIS_URL` — optional Redis connection URL. When set, agent mapping and rate limits are persisted in Redis.
   - `ESTIMATOR_STORE_PATH` — optional path for persisted estimator config/catalog store (default: `bridge/data/estimator.json`).
   - `HOUSECALL_PRO_API_BASE` — optional Housecall API base URL (default: `https://api.housecallpro.com`).
   - `HOUSECALL_PRO_API_KEY` — Housecall bearer API key token (recommended if your account supports API keys).
   - `HOUSECALL_PRO_ACCESS_TOKEN` — optional static bearer access token.
   - `HOUSECALL_PRO_CLIENT_ID`, `HOUSECALL_PRO_CLIENT_SECRET`, `HOUSECALL_PRO_REFRESH_TOKEN` — OAuth refresh credentials for automatic access-token renewal.
   - `HOUSECALL_PRO_TOKEN_URL` — optional OAuth token endpoint override (default: `<HOUSECALL_PRO_API_BASE>/oauth/token`).
   - `HOUSECALL_PRO_CREATE_ESTIMATE_PATH` — optional estimate create endpoint override (default: `/v1/estimates`).
   - `HOUSECALL_PRO_ADD_TO_JOB_ESTIMATE_PATH` — optional add-to-job estimate path template (default: `/v1/jobs/{job_id}/estimates`).
   - `HOUSECALL_PRO_UPDATE_ESTIMATE_PATH` — optional update-estimate path template (default: `/v1/estimates/{estimate_id}`).
   - `HOUSECALL_PRO_ADD_OPTION_NOTE_PATH` — optional estimate option note path template (default: `/v1/estimates/{estimate_id}/options/{estimate_option_id}/notes`).
   - `HOUSECALL_PRO_APPOINTMENT_LOOKUP_PATH` — optional appointment lookup path template used for context resolution, e.g. `/v1/schedule/{appointment_id}`.
   - `HOUSECALL_PRO_TEST_PATH` — optional test endpoint for `/integrations/housecall/test` (default: `/v1/customers`).
   - `HOUSECALL_PRO_TIMEOUT_MS` — timeout for Housecall API calls (default: `30000`).
   - `TELEGRAM_BOT_TOKEN` — (optional) from [@BotFather](https://t.me/BotFather) if you want Telegram.
4. Run the bridge with Doppler injecting env vars:
   ```bash
   doppler run -- node server.js
   ```
   Or: `doppler run -- npm start`.

Without Doppler, set the same variables in your environment and run `node server.js`.

## Install and run

```bash
cd bridge
npm install
doppler run -- npm start
```

Default port: 3000. Set `PORT` to change it.

## Endpoints

- `GET /health` — Health check.
- `POST /chat` — Send a message to the agent. Body: `{ "user_id": "required-id", "message": "your text" }`. Requires auth token. Returns `{ reply, agent_id, state, parsed, dispatched }` when the agent has finished (or a partial reply on timeout). Polling is used to wait for completion.
- `GET /agent/:userId` — Get stored `agent_id` for a user (if any). Requires auth token.
- `POST /ingest` — Run HVAC catalog import from `bridge/imports/incoming/`. Requires auth token. Returns validation report. Optional body/query: `profile=preferred|canonical_csv_only` and/or `only=...`. See `imports/README.md`.
- `GET /` — Simple PWA chat UI (served from `public/`).
- `PUT /estimator/config` — Save pricing assumptions for one user. Body: `{ "user_id": "...", "config": { ... } }`.
- `PUT /estimator/catalog` — Save/replace parts + equipment catalog. Body: `{ "user_id": "...", "items": [ ... ] }`.
- `GET /estimator/profile` — Read current estimator config + catalog (`user_id` query param or `x-user-id` header).
- `POST /estimator/changeout-plan` — Intake-driven residential changeout planner (lane classification + questions + recommended options + optional estimate preview). By default, it auto-loads the ingested `preferred` profile catalog at runtime.
- `POST /estimator/estimate` — Generate deterministic estimate totals and printable HTML. Auto-loads ingested `preferred` profile catalog by default (same runtime options as `changeout-plan`). Body: `{ "user_id": "...", "selections": [ ... ], "manual_items": [ ... ], "customer": { ... }, "project": { ... }, "adjustments": { ... }, "output": "json|html" }`.
- `POST /estimator/export/housecall` — Build and send estimate to Housecall Pro. Supports dry-run and payload override.
- `GET /integrations/housecall/config` — Returns Housecall auth mode summary (no secrets).
- `POST /integrations/housecall/test` — Runs a lightweight authenticated test call to Housecall.
- `POST /integrations/housecall/request` — Debug endpoint for direct Housecall API calls.
- `POST /integrations/housecall/resolve-context` — Lookup appointment context and extract linked IDs (job/estimate/option).

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
      "appointment_lookup_path": "/v1/schedule/{appointment_id}",
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
    "appointment_lookup_path": "/v1/schedule/{appointment_id}"
  }'
```

You can also do this inside export by providing:

```json
{
  "housecall": {
    "appointment_id": "apt_123",
    "resolve_context": true,
    "appointment_lookup_path": "/v1/schedule/{appointment_id}"
  }
}
```

### Notes on payload mapping

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

## Telegram

If `TELEGRAM_BOT_TOKEN` is set, the bridge starts a Telegram bot and forwards every message to the same agent (user id = `telegram:<chatId>`). Replies are sent back to the chat after the agent completes.

## Orchestrator protocol

When the agent outputs lines like `SUBAGENT: repo=..., prompt=...` or `LOCAL_ACTION: action_id`, the bridge parses and executes them if allowlists permit, then returns both `parsed` and `dispatched` on `/chat`. See `docs/orchestrator-protocol.md` in the repo root.

## Rate limits

The bridge retries on Cursor API 429 with a delay. HTTP `/chat` rate limiting is enforced per user. With `REDIS_URL`, limits persist across restarts and scale across bridge instances. Without Redis, in-memory limits are used. Polling is every 15s by default; tune in `server.js` if needed.
