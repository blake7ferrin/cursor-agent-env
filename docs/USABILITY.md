# Usability and UX improvements

Ongoing checklist for making the bridge, estimator, and Telegram experience easier to use. Tick items as done and add new ideas as we find them.

---

## Done

- **Housecall: use existing customer** — Export resolves customer by name/email/phone so estimates link to existing HCP customers instead of always creating new ones. `GET /integrations/housecall/customers` for search.
- **Line item cost + price** — Estimate HTML and Housecall line descriptions show both cost and price (Cost column in HTML; "Cost: $X.XX" in HCP description).
- **Telegram reply formatting** — Agent replies (including estimates with markdown tables) are converted for Telegram: tables → bullet lines, `**bold**` → HTML, escaped for `parse_mode: 'HTML'`, length capped. Fallback to plain text if parse fails.
- **Agent → Housecall** — Agent can send estimates via `HOUSECALL_EXPORT:` so the bridge runs the wired integration; docs and MEMORY updated so the agent doesn’t build its own script.
- **Estimate summary block** — After a Housecall export, the Telegram reply includes a block: customer (existing / creating new / multiple matches — pass ID or email), summary (N items · $X total), notifications (on/off), and status (Sent / dry-run ok).
- **Prompt for customer: existing vs new, multiple matches** — Export response includes `customer_resolution` (used_existing, match_count, customer_name, matches_preview). Telegram shows: "Using existing — Name", "Creating new — Name", or "N matches — pass housecall_customer_id or email to pick one".
- **Notifications enabled** — Housecall payload supports `housecall.notifications_enabled: true|false`. Agent can ask "Enable notifications for this customer?" and pass it; Telegram block shows "🔔 Notifications: on/off".

---

## Candidate (to do or revisit)

- **Dry-run summary in Telegram** — When Housecall export is dry_run, include a one-line summary of what would be sent (e.g. "Would create estimate for Jane Smith, 3 line items, $X total") in the Telegram message. *(Now covered by estimate summary block + customer resolution block.)*
- **Clearer errors to Telegram** — On export or estimator errors, send a short user-facing message (e.g. "Estimate failed: missing SKU" or "Housecall: customer not found") instead of raw error text.
- **Estimate summary block** — *(Done: block shows N items · $X total after export.)*
- **Prompt for missing customer fields** — *(Done: multiple matches show "pass housecall_customer_id or email to pick one"; Telegram shows customer line.)*
- **Prompt for existing vs new customer** — *(Done: Telegram shows "Using existing — Name" or "Creating new — Name".)*
- **Notifications toggle** — *(Done: housecall.notifications_enabled in payload; Telegram shows on/off.)*
- **Poll interval** — Reduce wait-for-completion poll from 15s to 5–10s for faster Telegram replies (tradeoff: more API calls).
- **PWA chat** — Apply similar formatting (or markdown rendering) to the PWA chat UI so estimates look good there too.
- **Agent instructions for Telegram** — In the system prompt or MEMORY, suggest the agent format replies for Telegram when appropriate (e.g. short paragraphs, bullet lists instead of dense tables when possible).

---

## How to use this doc

- When you notice something clunky or confusing, add it under **Candidate** with a short description.
- When we implement something, move it to **Done**.
- Prioritize items that affect daily use (Telegram, Housecall export, estimate readability).
