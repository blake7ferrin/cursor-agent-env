---
name: scheduled-tasks
description: How to read tasks/schedule.md (or MEMORY.md) and respond to time-context prompts from the scheduler (e.g. "It's Monday 9am; run weekly review").
---

# Scheduled tasks

## When to use

- The incoming prompt includes current date/time (e.g. "It's Monday 9am UTC" or "2025-02-24 08:00") and asks you to run scheduled tasks.
- You are acting as the agent triggered by a cron or scheduler.

## Instructions

1. **Load schedule:** Read **tasks/schedule.md** if it exists; otherwise check **MEMORY.md** for a "Schedule" or "Recurring tasks" section that describes what to do when (e.g. "Every Monday: weekly review"; "Daily 8am: add today's priorities to memory").
2. **Match time to tasks:** Using the current date and time (and timezone if provided), determine which scheduled items apply (e.g. "Monday 9am" → weekly review; "daily 8am" → today's priorities).
3. **Execute:** Perform the listed actions. Typical tasks:
   - Summarize last week into MEMORY.md or the daily log.
   - Add today's priorities or a short plan to memory/YYYY-MM-DD.md.
   - Update MEMORY.md with any standing decisions or reminders.
4. **Confirm:** After running, append a line to the daily log noting that the scheduled task ran (e.g. "09:00 – Weekly review completed.").

## If no schedule file exists

- Create **tasks/schedule.md** with a template (e.g. "## Weekly (Monday 9am)\n- Weekly review: summarize last week to memory.\n\n## Daily (8am)\n- Add today's priorities to memory/YYYY-MM-DD.md.") and run any default you infer, or reply that no schedule is configured and suggest the user add one.
