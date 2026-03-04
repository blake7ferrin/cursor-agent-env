# Orchestrator protocol

This document defines the structured output format that the **agent** (running in this repo) uses and the **bridge** (your backend that holds the Cursor API key) parses. Keeping this in sync ensures the orchestrator can delegate work to subagents and local actions reliably.

## Overview

- The agent runs in the **agent-env** repo and has no API key. It outputs **text** that may contain **command lines**.
- The bridge reads the agent's response, looks for lines matching the patterns below, and executes them (calls Cursor API for subagents, calls local relay for local actions).

## Command format

All command lines start with a keyword followed by a colon and key-value pairs. One command per line. Keys are case-insensitive; values are trimmed.

### SUBAGENT

Launch a Cloud Agent on a **different** repository.

```
SUBAGENT: repo=<GitHub repo URL>, prompt=<task description>
```

- **repo:** Full GitHub repository URL (e.g. `https://github.com/owner/repo` or `github.com/owner/repo`). Must be a repo the Cursor account can access.
- **prompt:** Self-contained task description for the subagent. No newlines in the value; use a single line. The bridge passes this as `prompt.text` to `launch_agent`.

**Example:**

```
SUBAGENT: repo=github.com/me/my-app, prompt=Add a health check endpoint at GET /health that returns 200 and {"status":"ok"}
```

The bridge should call the Cursor Cloud Agents API: `launch_agent` with `source.repository` = that URL and `prompt.text` = that string.

### LOCAL_ACTION

Request execution of a whitelisted action on the user's machine (via the bridge → local relay).

```
LOCAL_ACTION: <action_id>
```

- **action_id:** Identifier that the bridge and local relay understand (e.g. `backup_script`, `open_browser`, `lock_screen`). The agent should only use actions that are documented or that the user has specified. The bridge sends this to the local relay (e.g. `POST /run` with `{ "action": "backup_script" }`).

**Example:**

```
LOCAL_ACTION: backup_script
```

### HOUSECALL_EXPORT

Send an estimate to Housecall Pro. The bridge runs the same logic as `POST /estimator/export/housecall`. When the user is chatting over **Telegram**, omit `user_id` — the bridge injects `telegram:<chatId>` automatically.

```
HOUSECALL_EXPORT: <single-line JSON payload>
```

Payload shape (all fields optional except you need either `selections`/`manual_items` or a prebuilt `estimate`): `user_id`, `customer` (e.g. `{ "name": "...", "housecall_customer_id": "..." }`), `project` (e.g. `{ "summary": "...", "housecall_job_id": "..." }`), `selections` (e.g. `[{ "sku": "...", "quantity": 1 }]`), `manual_items`, `adjustments`, `housecall` (e.g. `{ "dry_run": true, "notifications_enabled": true }`, `mode`, `job_id`, `estimate_id`, etc.). Use `housecall.dry_run: true` to validate without sending.

**Example (dry run):**

```
HOUSECALL_EXPORT: {"customer":{"name":"Jane Smith"},"project":{"summary":"Replace heat pump"},"selections":[{"sku":"HP-3T-16","quantity":1}],"housecall":{"dry_run":true}}
```

**Example (live send; user_id omitted for Telegram):**

```
HOUSECALL_EXPORT: {"customer":{"name":"Jane","housecall_customer_id":"cust_123"},"project":{"housecall_job_id":"job_456"},"selections":[{"sku":"HP-3T-16","quantity":1}]}
```

The bridge executes each `HOUSECALL_EXPORT` line and includes the result in the reply (e.g. "📤 Sent to Housecall Pro" or an error message).

## Parsing rules (for the bridge)

1. Scan the agent's response (e.g. the last assistant message or the full conversation turn) for lines that **start with** `SUBAGENT:` or `LOCAL_ACTION:`.
2. **SUBAGENT:** Extract `repo` and `prompt`. Both are required. If the line is malformed, skip it or log and skip.
3. **LOCAL_ACTION:** Extract the rest of the line as `action_id` (trimmed). If empty, skip.
4. **HOUSECALL_EXPORT:** Extract the rest of the line as JSON. If valid object, add to `housecallExports` list.
5. Execute each parsed command: for SUBAGENT, call `launch_agent`; for LOCAL_ACTION, call the local relay; for HOUSECALL_EXPORT, call the bridge’s Housecall export (with optional context for `user_id`).
5. Optionally track subagent IDs (from the API response) and use webhooks to notify the orchestrator or user when subagents complete.

## Optional / future commands

These can be added later and documented here so the bridge can extend its parser:

- **REMIND:** e.g. `REMIND: <timestamp or relative time>, <message>` — schedule a reminder (bridge would need a reminder store or integration).
- **WEBHOOK_RESULT:** e.g. `WEBHOOK_RESULT: agent_id=<id>, status=done` — used when the bridge sends a follow-up to the orchestrator with subagent completion; the agent might output this to confirm or to trigger a summary.

## Usability

See **docs/USABILITY.md** for a checklist of done and candidate UX improvements (Telegram formatting, Housecall customer resolution, estimate display, errors, etc.). Add items there as you find things to optimize.

## Security

- The bridge must validate **repo** (e.g. allowlist of repos the user permits) before calling `launch_agent`.
- The local relay must enforce a **whitelist** of `action_id` values so the agent cannot trigger arbitrary commands.
