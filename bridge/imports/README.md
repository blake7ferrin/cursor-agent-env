# HVAC estimator import pipeline

Import equipment options and pricing (AC Pro, Day & Night, adders) into the estimator catalog.

## Folder structure

- **incoming/** — Raw uploads (ZIP unpacked here, or drop CSV/XLSX). Leave files here for ingestion.
- **templates/** — Empty CSV templates with required headers. Copy to fill in new equipment or adders.
- **catalog/** — Validated, merged catalog written by the importer (JSON). Consumed by the planner/estimator.

## Schema (equipment and adders)

All CSVs use the same column set. Required for equipment: `name`, `category`, `subcategory_1`, `price`, `cost`. Optional: `industry`, `description`, `taxable`, `unit_of_measure`, `online_booking_enabled`.

| Column | Required | Notes |
|--------|----------|--------|
| industry | No | e.g. "Heating and Air Conditioning" |
| category | Yes | e.g. "EQUIPMENT", "CHANGE-OUT INSTALLS", "ADDERS – LABOR & ACCESS" |
| subcategory_1 | Yes | e.g. "AC PRO M SERIES", "SPLIT SYSTEM" |
| name | Yes | Display name; tonnage/system type often in name (e.g. "2 Ton", "Heat Pump") |
| description | No | Full product/install description |
| price | Yes | Sell price (number) |
| cost | Yes | Cost (number); must be &lt;= price for margin sanity |
| taxable | No | true/false |
| unit_of_measure | No | e.g. "Each" |
| online_booking_enabled | No | true/false |

Validation checks: missing tonnage/system type/phase (parsed from name or flagged), duplicate SKUs (by name + subcategory_1), bad costs (non-numeric, cost &gt; price).

## Run ingestion

From repo root:

```bash
cd bridge
npm run ingest
```

Or with explicit path or only specific files (recommended for clean catalog):

```bash
node imports/ingest.js
node imports/ingest.js --dir imports/incoming
node imports/ingest.js --only CLEAN,ChangeOut_Pricebook
```

Using `--only CLEAN,ChangeOut_Pricebook` limits to the canonical AC Pro equipment list and change-out/adders pricebook (same schema); other CSVs in `incoming/` may have different columns and produce validation errors.

Ingester reads all `.csv` files in `incoming/` (or only those whose names contain the `--only` substrings), validates, merges into one catalog, and writes:

- `imports/catalog/equipment-and-adders.json` — validated rows for the planner
- `imports/validation-report.json` — errors and warnings (missing attributes, duplicates, bad costs)

## HTTP endpoint (optional)

`POST /ingest` (requires bridge auth token). Runs the importer and returns the validation report and exit code. Body or query: `only=CLEAN,ChangeOut_Pricebook` to restrict to canonical files.

## Source files (this bundle)

- **AC Pro equipment:** `PolarAir_ACPro_Equipment_v7_AHRI_SEER2_ALL_TONNAGES_CLEAN.csv` (preferred), or Pricing_v2 / other AC Pro CSVs.
- **Change-out / adders:** `PolarAir_ChangeOut_Pricebook_v1.csv` or `PolarAir_ChangeOut_Installs_v3_SALES_DESCRIPTIONS.csv`.
- **Google Sheet:** Export as CSV from the linked sheet and drop into `incoming/` (or use the provided `.xlsx`; ingest script supports CSV first).

Google Sheet link: see `incoming/google-sheet-link.txt`.
