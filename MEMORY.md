# Memory

Durable facts, preferences, and decisions. The agent updates this file when the user says "remember this" or when it infers something that should persist across sessions.

---

## Cursor product and this repo

- **Agent environment (Cursor dashboard, ~Feb 2025+):** Cursor supports secrets per environment, and views for terminal, desktop, and git. Slack can be connected to launch/control agents from channels (@Cursor). See README for details.
- **Slack vs bridge:** Slack is for *controlling* agents from team chat (task/thread-oriented). Telegram and the PWA (bridge) provide a *continuous chat* with one agent (same conversation, same memory). Slack does not replace Telegram/PWA for that use case; they can be used together (Slack for team, bridge for personal chat).
- **User is Cursor-only for now** (no bridge/Telegram/PWA in use yet).
- **Bridge baseline hardening implemented (2026-02-25):** HTTP auth token required, explicit `user_id` required, allowlisted orchestrator dispatch (`SUBAGENT`/`LOCAL_ACTION`), and optional Redis-backed persistence/rate limiting via `REDIS_URL`.

## HVAC estimator

- **Quoting / margin:** $125/hr is treated as fully loaded (tech labor + overhead). Gross-margin guardrail on quotes is used as the practical net-profit proxy; company-level accounting net can still differ (callbacks, bad debt, financing). For estimating, this setup is correct (recorded ~7d4750b).
- **Import pipeline (2026-02-25):** AC Pro + Day & Night (and adders) ingestion lives under `bridge/imports/`. Unpack ZIP into `bridge/imports/incoming/`; run `npm run ingest` in `bridge/` (or `POST /ingest` with auth). Use `--only CLEAN,ChangeOut_Pricebook` for canonical equipment + pricebook only. Catalog output: `imports/catalog/equipment-and-adders.json`; validation: `imports/validation-report.json`. See `bridge/imports/README.md`.
