# Scheduled tasks

Define what the agent should do when the scheduler triggers it with a time-context prompt (e.g. "It's Monday 9am"). The agent reads this file and executes the matching items.

## Weekly (Monday 9am)

- **Weekly review:** Summarize last week's key events or decisions into MEMORY.md or the daily log as appropriate.

## Daily (8am)

- **Today's priorities:** Add a short "Today" or priorities section to **memory/YYYY-MM-DD.md** for the current day, if the user has shared priorities or if MEMORY.md contains a standing list to reflect.

## Customize

Edit the sections above or add new ones (e.g. "Last day of month", "Friday 5pm"). The scheduler prompt should include the current date and time so the agent can match which tasks to run.
