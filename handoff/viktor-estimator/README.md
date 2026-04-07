# Estimator handoff (for Viktor / external integration)

This folder is a **self-contained snapshot** of the HVAC estimating logic and the **built** equipment/adder catalog from this repo’s `bridge/`. Paths below are relative to `handoff/viktor-estimator/`.

## What to read first

1. **`bridge/estimator-domain.js`** — Default pricing config shape, `getDefaultEstimatorConfig()`, validation helpers, `EstimatorValidationError`.
2. **`bridge/estimator-engine.js`** — Core formulas: per-line material + labor + burden + overhead + contingency → target sell from **gross margin**; JSON + HTML output; imports Polar Air branding.
3. **`bridge/estimator-changeout.js`** — Residential changeout **intake planner** (lanes, risk→adder mapping, recommended SKUs); calls `buildEstimate` for previews.
4. **`bridge/installer-pricing.js`** — Piece-rate / installer labor overlays used by the changeout path.
5. **`bridge/housecall-mapper.js`** — Maps a built estimate into Housecall Pro upsert plans (create / add to job / update); no HTTP — just payload planning.

## Catalog and ingest

| File | Role |
|------|------|
| `bridge/imports/catalog/equipment-and-adders.json` | **Canonical built catalog** (~180KB): SKUs, costs, labor hours, attributes after ingest. |
| `bridge/imports/source-profiles.json` | Which raw files define profiles like `preferred`. |
| `bridge/imports/catalog-feature-enrichment.json` | Optional feature bullets merged by the adapter. |
| `bridge/imports/catalog-adapter.js` | Loads profile → estimator-shaped line items (paths assume `imports/` layout as here). |
| `bridge/imports/validation-report.json` | Last ingest validation summary (errors, file list). |
| `bridge/imports/README.md` | How to run ingest from CSV/XLSX in the full repo. |

## API contracts (Zod)

`bridge/validation/schemas.js` — Request shapes for:

- `POST /estimator/changeout-plan` → `changeoutPlanBodySchema`
- `POST /estimator/estimate` → `estimateBodySchema`
- `POST /estimator/export/housecall` → `exportHousecallBodySchema`

## Branding

`bridge/branding/polar-air.js` — Company name, logo path (for HTML served from bridge `public/`), warranty / disclaimer blocks.

## Persistence (full bridge only)

`bridge/estimator-store.js` — Loads/saves per-user config + catalog on disk when running the real bridge (`bridge/data/estimator.json`). The **handoff** copy is for reading the schema and merge behavior; paths inside it still point at the full repo when executed as-is.

## Business assumptions (authoritative in repo memory)

See root **`MEMORY.md`** in this repository — e.g. default labor rate, tax, margin targets, AC Pro / Day & Night priority. Those are not duplicated here to avoid drift.

## Lineage

Copied from branch work in the Cursor agent env repo. Regenerate the JSON catalog with `npm run ingest` under `bridge/` when source CSV/XLSX changes.
