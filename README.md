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
- **bridge/** — Optional bridge service (Node.js) for Telegram and PWA; run with Doppler for secrets. Use it when you want Telegram or the PWA chat, or when you need the orchestrator protocol parsed by your own backend; Cursor’s native Slack + agent environment can cover many “control agents from elsewhere” needs without the bridge.

## Quick start (Cursor only)

1. Clone this repo and open it in Cursor (or add it to your Cursor dashboard).
2. Start a Cloud Agent on this repo from the Cursor dashboard.
3. Chat; the agent will read and update MEMORY.md and the daily log. Continue on mobile at [cursor.com/agents](https://cursor.com/agents).

## Cursor agent environment (dashboard)

Cursor’s agent environment (dashboard) lets you:

- **Secrets per environment** — Set API keys and env vars per agent environment in Cursor (Dashboard → your agent/environment), so you may not need Doppler or a bridge for secrets when using Cursor + Slack only.
- **Terminal, desktop, git views** — In the dashboard you can see terminal output, git state, and other context for running agents.
- **Slack** — Connect Slack (Dashboard → Integrations); then in any channel you can @Cursor with a prompt to launch or control agents. Use `help` and `settings` in Slack to configure default repo, branch, and model.

So for **Cursor-only or Cursor + Slack**, the product already gives you environment secrets and a way to run and monitor agents without running the bridge.

## Slack vs Telegram / PWA (bridge)

| | **Slack (native)** | **Telegram / PWA (bridge)** |
|--|--------------------|-----------------------------|
| **What it is** | Launch and control agents from team channels; agents read the thread and act. | Dedicated chat with the *same* agent; the bridge keeps a conversation (user → agent id) and streams replies back. |
| **Use case** | “Kick off a task from a thread,” “@Cursor fix this bug,” team visibility. | Personal or small-group chat with one persistent agent (memory, daily log, this repo’s “soul”). |
| **Chat interface** | Task/thread-oriented: you send a prompt, agent runs, you see updates in Slack. Not a single long-running 1:1 chat. | True chat: you message the bot, get a reply in the same thread; the bridge maintains session and polls for the reply. |

**Summary:** Slack doesn’t replace Telegram or the PWA if you want a **continuous chat** with one agent (same conversation, same memory). Slack is great for **triggering and controlling** agents from team chat. Use both if you want: Slack for team workflows, bridge + Telegram/PWA for personal chat with this repo’s agent.

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
