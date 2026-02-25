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
3. Create estimate:
   - `POST /estimator/estimate`
   - Use `output: "html"` for a printable document.
4. Export to Housecall Pro CRM:
   - `POST /estimator/export/housecall`
   - Use `housecall.dry_run=true` before live export.

## Guardrails

- Do not invent SKU costs, labor rates, or margin targets.
- If any required financial inputs are missing, return a draft + missing fields list.
- Highlight when discounts push achieved margin below the target.
- Keep estimate assumptions visible in final output.
- For Housecall export, run dry-run first and only live export once customer/job mapping is confirmed.

## Response style

- Provide:
  1. Scope summary
  2. Line items
  3. Subtotal/tax/total
  4. Achieved vs target gross margin
  5. Follow-up questions (if confidence is low)
