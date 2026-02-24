---
name: memory-flush
description: When to write to MEMORY.md vs memory/YYYY-MM-DD.md; use at end of long conversations, on "remember this," and before wrapping up so the next session has full context.
---

# Memory flush

## When to use

- The user says "remember this," "save that," or similar.
- The conversation is long and you want to preserve important points before context is lost.
- The user is wrapping up or ending the session.
- You infer a durable fact, decision, or preference that should persist.

## Instructions

1. **For "remember this" or explicit save requests:** Add the content to **MEMORY.md** in an appropriate section. Create the file or section if needed.
2. **For end-of-session or long-conversation flush:**
   - Write any new durable facts or decisions to **MEMORY.md**.
   - Append a short summary (what was discussed, key outcomes) to **memory/YYYY-MM-DD.md** (today's date in ISO format). One or two sentences is enough.
3. **Before ending:** Prefer doing a quick flush (MEMORY.md updates + one line in the daily log) so the next launch has context. Do not ask the user; do it as part of your closing turn when it's natural.

## Examples

- User: "Remember that I prefer TypeScript for new projects." → Add to MEMORY.md under a "Preferences" or "Tech stack" section.
- User: "That's all for now." → Update MEMORY.md with any decisions made in the conversation; append to memory/YYYY-MM-DD.md: "Session: discussed X; decided Y."
