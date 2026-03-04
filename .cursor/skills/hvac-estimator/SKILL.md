---
name: hvac-estimator
description: Build HVAC estimates from catalog costs, labor burden, overhead, and margin targets using the bridge estimator endpoints.
---

# HVAC estimator workflow

## When to use

- The user asks for HVAC pricing, quote generation, or estimate drafts.
- The user provides parts/equipment costs, labor and overhead assumptions, or profit goals.
- The user wants print-ready estimate output (HTML that can be saved as PDF).

## Required data

Collect or confirm these before producing a final estimate:

1. **Business pricing config**
   - `laborRatePerHour`
   - `laborBurdenRate`
   - `overheadRate`
   - `targetGrossMargin`
   - `defaultTaxRate` (if applicable)
2. **Catalog data**
   - SKU
   - Item name
   - Unit cost
   - Default labor hours
   - Optional features/notes
3. **Job-specific estimate input**
   - Selected SKUs and quantities
   - Manual line items (if needed)
   - Customer + project summary
   - Adjustments (discounts, permit, trip charge)

## Bridge API sequence

Assuming bridge is running and `BRIDGE_AUTH_TOKEN` is available:

1. Save/update pricing rules:
   - `PUT /estimator/config`
2. Save/update catalog:
   - `PUT /estimator/catalog`
3. Run intake planner:
   - `POST /estimator/changeout-plan`
   - Use planner lane result to decide if estimate can be auto-built or needs follow-up.
4. Create estimate:
   - `POST /estimator/estimate`
   - Use `output: "html"` for a printable document.
5. Export to Housecall Pro CRM:
   - **Housecall Pro is already integrated in the bridge.** When the user is on Telegram or the PWA, **always** use the wired integration by outputting one line—do **not** write your own script or say no integration exists.
   - Output this so the bridge runs the export:
     ```
     HOUSECALL_EXPORT: <compact one-line JSON>
     ```
     Omit `user_id` when the user is on Telegram (the bridge fills it in). Use `housecall.dry_run: true` for a test run first. Example:
     ```
     HOUSECALL_EXPORT: {"customer":{"name":"Jane Smith"},"project":{"summary":"Replace heat pump"},"selections":[{"sku":"HP-3T-16","quantity":1}],"housecall":{"dry_run":true}}
     ```
     Then, if the user confirms, output the same without `dry_run` to send live. The bridge will run the export and add a block to your reply: customer (existing / new / multiple matches), summary (N items · $X total), notifications on/off, and status.
   - **Payload shape:** `customer` (name, optional housecall_customer_id), `project` (summary, optional housecall_job_id, housecall_estimate_id), `selections` (array of { sku, quantity }), optional `manual_items`, `adjustments`, and `housecall` (dry_run, mode, job_id, estimate_id, **notifications_enabled** true/false, etc.).
   - **Prompts:** Ask “Use existing customer [Name] or create new?” when the bridge might match an existing customer. Ask “Enable notifications for this customer?” and set `housecall.notifications_enabled: true` or `false` in the payload. The Telegram reply will show which customer was used and whether notifications are on or off.
   - If the user is **not** on the bridge (e.g. only in Cursor IDE), tell them to run the export via the bridge (e.g. Telegram) or use curl to `POST /estimator/export/housecall` with the same payload.
   - Prefer `housecall.auto_upsert=true` (or omit; it's default) so the bridge picks the best target. Use `housecall.mode` for context-aware exports: `update_estimate`, `add_to_job`, etc.

## Guardrails

- **Housecall:** Use the bridge’s existing Housecall Pro integration (output `HOUSECALL_EXPORT: {...}`). Do not write your own Housecall API script or assume no integration exists; see MEMORY.md “Housecall Pro integration”.
- Do not invent SKU costs, labor rates, or margin targets.
- If any required financial inputs are missing, return a draft + missing fields list.
- Highlight when discounts push achieved margin below the target.
- Keep estimate assumptions visible in final output.
- For Housecall export, run dry-run first and only live export once customer/job mapping is confirmed.
- If only appointment context is known, resolve context first (`/integrations/housecall/resolve-context`) or provide `housecall.resolve_context=true` with an appointment lookup path template.
- For residential replacement intake, prioritize `changeout-plan` lane automation:
  - `auto_ready` -> build + export
  - `needs_selection` -> ask user to pick recommended option SKU
  - `awaiting_vendor_quote` -> collect distributor pricing and re-run
  - `manual_review` -> escalate commercial/high-complexity scopes

## Response style

- Provide:
  1. Scope summary
  2. Line items
  3. Subtotal/tax/total
  4. Achieved vs target gross margin
  5. Follow-up questions (if confidence is low)
