---
name: orchestrator-protocol
description: Output structured commands for the bridge to parse (SUBAGENT, LOCAL_ACTION). Use when the user asks to run work on other repos or to run local actions. Format is defined in docs/orchestrator-protocol.md.
---

# Orchestrator protocol

## When to use

- The user asks to split work across multiple repositories or to "have the frontend/backend do X."
- The user asks to run something on their machine (e.g. backup, open app, run script) and the bridge will forward to a local relay.
- You decide to delegate a task to a subagent on another repo.

## Instructions

1. **Subagents (work on another repo):** Output one line per subagent in this format:
   ```
   SUBAGENT: repo=<full GitHub repo URL>, prompt=<task description>
   ```
   Use the exact repo URL (e.g. `https://github.com/owner/repo` or `github.com/owner/repo`). The prompt should be self-contained so the subagent can execute without extra context.

2. **Local actions (run on user's machine):** Output:
   ```
   LOCAL_ACTION: <action_id>
   ```
   where `action_id` is a whitelisted identifier the bridge and local relay understand (e.g. `backup_script`, `open_browser`). Do not invent arbitrary commands; use actions that are documented or that the user has referred to.

3. **Placement:** Emit these lines in your response so the bridge can parse them. You may include a short human-readable summary before or after. The bridge looks for lines starting with `SUBAGENT:` or `LOCAL_ACTION:`.

4. **Reference:** Full format and future commands (e.g. REMIND, WEBHOOK_RESULT) are in **docs/orchestrator-protocol.md**.

## Examples

- User: "Add login to the frontend and an auth endpoint to the backend."
  - Output (among your reply):  
    `SUBAGENT: repo=github.com/me/my-frontend, prompt=Add a login button that calls /api/auth and displays the user name`  
    `SUBAGENT: repo=github.com/me/my-backend, prompt=Add POST /api/auth endpoint that validates credentials and returns a JWT`
- User: "Run my backup script on my PC."  
  - Output: `LOCAL_ACTION: backup_script`
