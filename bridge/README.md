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

## Telegram

If `TELEGRAM_BOT_TOKEN` is set, the bridge starts a Telegram bot and forwards every message to the same agent (user id = `telegram:<chatId>`). Replies are sent back to the chat after the agent completes.

## Orchestrator protocol

When the agent outputs lines like `SUBAGENT: repo=..., prompt=...` or `LOCAL_ACTION: action_id`, the bridge parses and executes them if allowlists permit, then returns both `parsed` and `dispatched` on `/chat`. See `docs/orchestrator-protocol.md` in the repo root.

## Rate limits

The bridge retries on Cursor API 429 with a delay. HTTP `/chat` rate limiting is enforced per user. With `REDIS_URL`, limits persist across restarts and scale across bridge instances. Without Redis, in-memory limits are used. Polling is every 15s by default; tune in `server.js` if needed.
