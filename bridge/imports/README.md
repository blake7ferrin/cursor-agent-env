# HVAC estimator import pipeline

Import equipment options and pricing (AC Pro, Day & Night, adders) into the estimator catalog.

## Folder structure

- **incoming/** — Raw uploads (ZIP unpacked here, or drop CSV/XLSX/PDF). Leave files here for ingestion.
- **templates/** — Empty CSV templates with required headers. Copy to fill in new equipment or adders.
- **catalog/** — Validated, merged catalog written by the importer (JSON). Consumed by the planner/estimator.
- **source-profiles.json** — Named source profiles (file include lists + XLSX parsing options).

## Schema (equipment and adders)

All normalized rows use the same required fields: `name`, `category`, `subcategory_1`, `price`, `cost`.
Optional fields: `industry`, `description`, `taxable`, `unit_of_measure`, `online_booking_enabled`.

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

Validation checks: missing tonnage/system type (parsed from name or flagged), duplicate keys (category + subcategory_1 + name), bad costs (non-numeric, cost &gt; price).

## Run ingestion

From repo root:

```bash
cd bridge
npm run ingest
```

Or with explicit path/profile or only specific files:

```bash
node imports/ingest.js
node imports/ingest.js --dir imports/incoming
node imports/ingest.js --only CLEAN,ChangeOut_Pricebook
node imports/ingest.js --profile preferred
node imports/ingest.js --profile canonical_csv_only
```

Recommended runs:

- `--profile preferred`  
  Uses your preferred source list:
  - Day & Night Google Sheet XLSX (parsed to equipment rows)
  - AC Pro clean CSV + ChangeOut pricebook CSV
  - PDF references (logged in report as manual reference only)
- `--profile canonical_csv_only`  
  Strictly uses clean AC Pro + ChangeOut CSVs.

Ingester reads selected CSV/XLSX files, validates, merges into one catalog, and writes:

- `imports/catalog/equipment-and-adders.json` — validated rows for the planner
- `imports/validation-report.json` — errors/warnings/duplicates and manual reference files

## HTTP endpoint (optional)

`POST /ingest` (requires bridge auth token). Runs importer and returns validation report + exit code.

Body/query options:
- `profile=preferred` or `profile=canonical_csv_only`
- `only=CLEAN,ChangeOut_Pricebook`

## Source files (this bundle)

- **AC Pro equipment:** `PolarAir_ACPro_Equipment_v7_AHRI_SEER2_ALL_TONNAGES_CLEAN.csv` (preferred), or Pricing_v2 / other AC Pro CSVs.
- **Change-out / adders:** `PolarAir_ChangeOut_Pricebook_v1.csv` or `PolarAir_ChangeOut_Installs_v3_SALES_DESCRIPTIONS.csv`.
- **Google Sheet:** provided `.xlsx` is parsed directly when using `--profile preferred`.

Google Sheet link: see `incoming/google-sheet-link.txt`.
