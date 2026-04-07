# Viktor handoff — Polar Air estimator logic & catalog

Self-contained copy of the **deterministic HVAC estimator** from this repo’s `bridge/`. Use this folder alone to read pricing math, request shapes, catalog output, and Housecall mapping—no need to trace the full Express server.

## Start here (reading order)

1. **`estimator-engine.js`** — Line-level costing: materials + labor + burden + overhead + contingency, target gross margin, totals.
2. **`estimator-domain.js`** — Config / domain types and defaults (what a “job” and “line item” look like).
3. **`estimator-changeout.js`** — Changeout planner (lanes, recommended SKUs, tie-in to catalog).
4. **`estimator-store.js`** — Persistence shape for per-user catalog and pricing config (bridge uses this at runtime).
5. **`installer-pricing.js`** — Installer / piece-rate style adders and guardrails used with the catalog.
6. **`housecall-mapper.js`** — Maps internal estimate lines to Housecall Pro line items / payloads.
7. **`validation/schemas.js`** — Zod schemas for estimator and Housecall export request bodies (contracts for APIs).
8. **`branding/polar-air.js`** — Logo path, warranty/disclaimer copy for printable proposals.

## Catalog & ingest

| Path | Purpose |
|------|---------|
| `imports/catalog/equipment-and-adders.json` | **Built catalog** (equipment + adders) used by the engine and planner at runtime. |
| `imports/catalog-adapter.js` | Loads/normalizes catalog for the bridge. |
| `imports/source-profiles.json` | Which raw files/sheets map to the catalog (`preferred` profile = Day & Night + AC Pro sources in the full repo). |
| `imports/catalog-feature-enrichment.json` | Extra feature metadata merged into catalog where applicable. |
| `imports/validation-report.json` | Last ingest validation snapshot from the machine that produced this tree. |
| `imports/README.md` | How ingest works in **`bridge/imports/`** in the full repo (ZIP → `incoming/` → `npm run ingest`). |

Raw vendor files (CSVs/XLSX) are **not** copied here to keep the handoff small; they live under `bridge/imports/incoming/` in the main repo. Regenerate `equipment-and-adders.json` there after changing sources.

## Business defaults (authoritative in repo root)

Polar Air assumptions (labor rate, margin targets, tax, import profile names) are curated in **`MEMORY.md`** at the repository root (section **HVAC estimator** / **data ingestion**). This handoff duplicates **logic + data artifacts**, not that narrative.

## Full bridge integration (not in this folder)

In production, these modules are wired by `bridge/server.js` (or equivalent) to routes such as:

- `POST /estimator/estimate` — JSON or printable HTML proposal.
- `POST /estimator/changeout-plan` — Planner output.
- `POST /estimator/export/housecall` — Build estimate and push to Housecall Pro.

Agent-facing workflow and `HOUSECALL_EXPORT` line format: **`docs/orchestrator-protocol.md`**, **`.cursor/skills/hvac-estimator/SKILL.md`**.

## Sharing with Viktor

Zip this folder, or point at this branch path: `handoff/viktor-estimator/`.
