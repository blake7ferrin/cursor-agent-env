# Agent identity and behavior

You are a persistent assistant with memory, skills, and a consistent identity. You operate in this repository as your workspace and use Markdown files as your long-term memory.

## Who you are

- You maintain **MEMORY.md** for durable facts, preferences, and decisions.
- You maintain **memory/YYYY-MM-DD.md** (daily logs) for session summaries and day-to-day context.
- At the start of each session (or when context is fresh), read **MEMORY.md** and today's (and optionally yesterday's) **memory/YYYY-MM-DD.md** so you have full context.
- When the user says "remember this" or you infer something that should persist, update **MEMORY.md**.
- Log session summaries or key events to **memory/YYYY-MM-DD.md** (append-only). Use the file for the current date in `YYYY-MM-DD` format.
- Before ending a long conversation or when the user is wrapping up, write any important durable points to **MEMORY.md** and append a short summary to the daily log so the next session has context.

## Memory files

- **MEMORY.md** — Curated long-term memory. Add facts, decisions, preferences, and anything that should survive across sessions.
- **memory/YYYY-MM-DD.md** — Daily log (append-only). One file per day; append session notes and events. Create the file with a short header if it does not exist.

If **MEMORY.md** or **memory/YYYY-MM-DD.md** does not exist yet, create it with a minimal header (e.g. `# Memory` or `# YYYY-MM-DD`) rather than failing. Treat a missing file as empty content.

## Skills and rules

- Follow project rules in `.cursor/rules/` and use skills in `.cursor/skills/` when they apply.
- When outputting structured commands for an external bridge (e.g. launching subagents or local actions), use the format defined in **docs/orchestrator-protocol.md**.

## Cursor Cloud specific instructions

### Service overview

The only runnable service is the **bridge** (`bridge/`), a Node.js/Express server that proxies messages between Telegram/PWA and the Cursor Cloud Agents API. See `bridge/README.md` for full details.

### Running the bridge (dev mode)

```bash
cd bridge && CURSOR_API_KEY=<your-key> BRIDGE_AUTH_TOKEN=<token> npm run dev
```

- `npm run dev` uses `node --watch server.js` for hot-reload.
- The server listens on port **3000** (override with `PORT` env var).
- Both `CURSOR_API_KEY` and `BRIDGE_AUTH_TOKEN` are **required** — the process exits immediately without either.
- `TELEGRAM_BOT_TOKEN` is optional; Telegram integration is disabled when absent.

### Endpoints to verify

- `GET /health` — returns `{"ok":true}` (no auth needed; quickest smoke test).
- `GET /` — serves the PWA chat UI from `bridge/public/index.html`.
- `POST /chat` — forwards messages to the Cursor Agents API (requires a valid `CURSOR_API_KEY`).

### Gotchas

- There is no linter configured. Unit tests exist: run `cd bridge && npm test` (uses `node --test` on `bridge/test/`).
- The bridge uses ES Modules (`"type": "module"` in `package.json`). Use `import`/`export`, not `require`.
- In-memory state (`store.js`) is lost on restart; this is by design for the current stage.
- `AGENT_ENV_REPO` defaults to a placeholder URL. Set it to the actual repo (e.g. `https://github.com/blake7ferrin/cursor-agent-env`) or the Cursor API returns `Bad Request`.
- `POST /chat` polls the Cursor API for up to 5 minutes. Cloud agents often take longer to boot and respond, so "Agent still running" timeouts are normal — the agent continues in the background.
