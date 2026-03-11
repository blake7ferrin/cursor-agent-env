---
name: construction-estimator
description: Build construction estimates from spreadsheet-driven costs, labor burden, overhead, and margin targets using the bridge estimator flow.
---

# Construction estimator workflow

## When to use

- The user asks for construction pricing, bid drafts, or estimate options outside HVAC-only scenarios.
- The user has a spreadsheet with material/labor/subcontractor costs and wants repeatable estimate math.
- The user wants estimate output that can be reviewed, printed, and optionally sent to Housecall Pro.

## Required intake

Collect these before final pricing:

1. **Pricing assumptions**
   - `laborRatePerHour`
   - `laborBurdenRate`
   - `overheadRate`
   - `targetGrossMargin`
   - `defaultTaxRate`
2. **Spreadsheet mapping**
   - Source file tab name(s)
   - Column mapping (example: `item_code`, `description`, `material_cost`, `labor_hours`, `qty`, `unit`)
   - Any formulas/overrides (minimum charge, crew minimums, waste %, rounding rules)
3. **Job-specific scope**
   - Selected line items and quantities
   - Manual one-off items
   - Customer + project summary
   - Adjustments (discounts, permit, trip, contingency)

## Line-item math (default)

Use spreadsheet logic if provided. If not, use this baseline:

1. Direct material = `material_cost * quantity`
2. Direct labor = `labor_hours * laborRatePerHour * (1 + laborBurdenRate)`
3. Other direct costs = subcontractor + equipment rental + permit + disposal (if provided)
4. Pre-overhead cost = material + labor + other direct costs
5. Overhead allocation = `pre_overhead_cost * overheadRate`
6. Total cost basis = `pre_overhead_cost + overhead_allocation`
7. Sell price target = `total_cost_basis / (1 - targetGrossMargin)`

If the spreadsheet has custom formulas, mirror those formulas and list deviations from this baseline.

## Bridge API sequence

Assuming bridge is running and `BRIDGE_AUTH_TOKEN` is available:

1. Save/update pricing config:
   - `PUT /estimator/config`
2. Save/update catalog rows built from the spreadsheet mapping:
   - `PUT /estimator/catalog`
3. Build estimate:
   - `POST /estimator/estimate`
   - Use `output: "html"` for print-ready output.
4. Optional Housecall export:
   - When user is on Telegram/PWA, output one line:
     - `HOUSECALL_EXPORT: <compact one-line JSON>`
   - Use `housecall.dry_run: true` first, then send live only after confirmation.

## Guardrails

- Do not invent costs, labor assumptions, or margin targets.
- If spreadsheet columns are ambiguous, stop and ask for a column-to-field mapping.
- Flag any line items that drive achieved margin below target.
- Keep assumptions, markups, and exclusions visible in the final estimate summary.
- For Housecall export, use the bridge integration; do not write custom Housecall API scripts.

## Response style

Provide:

1. Scope summary
2. Itemized line table (qty, unit cost, extended cost, sell price)
3. Subtotal/tax/total
4. Achieved vs target gross margin
5. Missing data questions (if any)
