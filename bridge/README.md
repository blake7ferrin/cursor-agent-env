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
- `GET /` — Simple PWA chat UI (served from `public/`).
- `PUT /estimator/config` — Save pricing assumptions for one user. Body: `{ "user_id": "...", "config": { ... } }`.
- `PUT /estimator/catalog` — Save/replace parts + equipment catalog. Body: `{ "user_id": "...", "items": [ ... ] }`.
- `GET /estimator/profile` — Read current estimator config + catalog (`user_id` query param or `x-user-id` header).
- `POST /estimator/estimate` — Generate deterministic estimate totals and printable HTML. Body: `{ "user_id": "...", "selections": [ ... ], "manual_items": [ ... ], "customer": { ... }, "project": { ... }, "adjustments": { ... }, "output": "json|html" }`.

## HVAC estimator MVP

The bridge now includes a first-pass HVAC estimator with:

- Deterministic pricing math (not freeform LLM arithmetic)
- Configurable labor burden, overhead, and target gross margin
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

### Example: generate estimate

```bash
curl -X POST http://localhost:3000/estimator/estimate \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_AUTH_TOKEN" \
  -d '{
    "user_id": "pwa:blake",
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

## Telegram

If `TELEGRAM_BOT_TOKEN` is set, the bridge starts a Telegram bot and forwards every message to the same agent (user id = `telegram:<chatId>`). Replies are sent back to the chat after the agent completes.

## Orchestrator protocol

When the agent outputs lines like `SUBAGENT: repo=..., prompt=...` or `LOCAL_ACTION: action_id`, the bridge parses and executes them if allowlists permit, then returns both `parsed` and `dispatched` on `/chat`. See `docs/orchestrator-protocol.md` in the repo root.

## Rate limits

The bridge retries on Cursor API 429 with a delay. HTTP `/chat` rate limiting is enforced per user. With `REDIS_URL`, limits persist across restarts and scale across bridge instances. Without Redis, in-memory limits are used. Polling is every 15s by default; tune in `server.js` if needed.
