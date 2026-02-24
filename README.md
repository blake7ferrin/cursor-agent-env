# Cursor Agent Environment (OpenClaw-style)

A GitHub repository that acts as the **persistent environment** (memory, skills, soul) for Cursor Cloud Agents. Use it with Cursor desktop/mobile, or with the **bridge** for Telegram and a simple PWA.

## What this repo is

- **AGENTS.md** — Agent identity and behavior (soul); instructions to read/write memory.
- **.cursor/rules/** — Cursor rules: load memory at start, append daily log, update MEMORY.md, graceful empty files.
- **.cursor/skills/** — Skills: memory-flush, orchestrator-protocol, scheduled-tasks.
- **MEMORY.md** — Long-term memory (durable facts, preferences, decisions).
- **memory/YYYY-MM-DD.md** — Daily logs (append-only).
- **tasks/schedule.md** — What to do when the scheduler runs (cron / time-context prompts).
- **docs/orchestrator-protocol.md** — Format for SUBAGENT and LOCAL_ACTION so the bridge can parse and execute.
- **bridge/** — Optional bridge service (Node.js) for Telegram and PWA; run with Doppler for secrets.

## Quick start (Cursor only)

1. Clone this repo and open it in Cursor (or add it to your Cursor dashboard).
2. Start a Cloud Agent on this repo from the Cursor dashboard.
3. Chat; the agent will read and update MEMORY.md and the daily log. Continue on mobile at [cursor.com/agents](https://cursor.com/agents).

## Quick start (Telegram or PWA)

1. Get a Cursor API key from [Cursor Dashboard → Integrations](https://cursor.com/dashboard?tab=integrations).
2. Set up [Doppler](https://doppler.com) (or env vars): `CURSOR_API_KEY`, `AGENT_ENV_REPO` (this repo’s GitHub URL), and optionally `TELEGRAM_BOT_TOKEN`.
3. Run the bridge:
   ```bash
   cd bridge && npm install && doppler run -- npm start
   ```
4. Open http://localhost:3000 for the PWA, or message your Telegram bot.

See **bridge/README.md** for details.

## Doppler (secrets)

The **bridge** needs `CURSOR_API_KEY` and optionally `TELEGRAM_BOT_TOKEN`. Run it with:

```bash
doppler run -- node bridge/server.js
```

Doppler injects env vars at runtime; no secrets in code or in this repo. See [Doppler CLI](https://docs.doppler.com/docs/cli).

## Repo write access

For the agent to persist memory and daily logs, the Cursor GitHub App (or your integration) must have **write** access to this repo so the agent can commit and push.

## Orchestrator and subagents

The agent in this repo can act as an **orchestrator**: it outputs structured lines (`SUBAGENT: repo=..., prompt=...`). The bridge (or your backend) parses them and calls the Cursor API to launch agents on **other** repos. You don’t need to open an agent in those repos manually. See **docs/orchestrator-protocol.md**.

## Scheduled tasks (cron)

Use a scheduler (cron, GitHub Actions, or the bridge) to call the Cloud Agents API with a time-context prompt (e.g. "It's Monday 9am. Read tasks/schedule.md and run scheduled tasks."). The agent uses the **scheduled-tasks** skill and **tasks/schedule.md** to decide what to do.

## License

MIT or your choice.
