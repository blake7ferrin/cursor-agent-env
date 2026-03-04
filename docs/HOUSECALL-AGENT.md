# Housecall Pro: use the wired integration

When the user asks to send an estimate to Housecall Pro (or "push to HCP" / "create in Housecall" / "add to my CRM") **and they are chatting via the bridge** (Telegram or PWA):

1. **Do not** write your own script or call the Housecall API yourself. **Do not** say that no integration exists.
2. **Use the bridge’s integration.** The bridge has the HCP API key and full export logic. You trigger it by outputting a single line:

   ```
   HOUSECALL_EXPORT: <one-line JSON>
   ```

3. **Payload:** Include `customer` (e.g. `{"name":"..."}`), `project` (e.g. `{"summary":"..."}`), `selections` (e.g. `[{"sku":"...","quantity":1}]`). Optional: `housecall` (e.g. `{"dry_run":true}` for a test run, `notifications_enabled": true` or `false` for customer notifications). Omit `user_id` on Telegram—the bridge sets it.

4. **Customer and notifications:** The bridge looks up existing customers by name/email/phone. In Telegram you’ll see whether it used an existing customer, created a new one, or found multiple matches (and to pass `housecall_customer_id` or email to pick). Ask the user “Use existing customer or create new?” when unsure; ask “Enable notifications for this customer?” and set `housecall.notifications_enabled` accordingly.

5. **References:** Full format and examples: **docs/orchestrator-protocol.md** (HOUSECALL_EXPORT). MEMORY.md section “Housecall Pro integration”. Skill: **.cursor/skills/hvac-estimator**.

Example (dry run):

```
HOUSECALL_EXPORT: {"customer":{"name":"Jane Smith"},"project":{"summary":"Replace heat pump"},"selections":[{"sku":"HP-3T-16","quantity":1}],"housecall":{"dry_run":true}}
```

Then, after the user confirms, send the same line without `"dry_run":true` to perform the live export.

With notifications and customer choice:

- Ask “Enable notifications for this customer?” and set `housecall.notifications_enabled: true` or `false` in the payload.
- The bridge will show in Telegram: existing vs new customer, estimate summary (N items · $X total), and notifications on/off.
