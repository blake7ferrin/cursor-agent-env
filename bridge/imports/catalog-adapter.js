import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '..');
const IMPORTS_ROOT = path.join(BRIDGE_ROOT, 'imports');
const CATALOG_JSON_PATH = path.join(IMPORTS_ROOT, 'catalog', 'equipment-and-adders.json');
const REPORT_JSON_PATH = path.join(IMPORTS_ROOT, 'validation-report.json');
const PROFILES_JSON_PATH = path.join(IMPORTS_ROOT, 'source-profiles.json');

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return `${value}`.trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function asBoolean(value, defaultValue = true) {
  const normalized = normalizeLower(value);
  if (!normalized) return defaultValue;
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return defaultValue;
}

function stableHash(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 12).toUpperCase();
}

function inferBrand(row) {
  const blob = `${normalizeText(row.subcategory_1)} ${normalizeText(row.name)}`.toLowerCase();
  if (blob.includes('ac pro')) return 'AC Pro';
  if (blob.includes('day & night') || blob.includes('day and night') || blob.includes('ion')) return 'Day & Night';
  if (blob.includes('trane')) return 'Trane';
  if (blob.includes('carrier')) return 'Carrier';
  return '';
}

function inferPhase(row) {
  const blob = `${normalizeText(row.name)} ${normalizeText(row.description)}`.toLowerCase();
  if (blob.includes('3 phase') || blob.includes('three phase')) return 'three';
  if (blob.includes('single phase') || blob.includes('1 phase')) return 'single';
  return '';
}

function inferSeer2(row) {
  const blob = `${normalizeText(row.name)} ${normalizeText(row.description)}`;
  const match = blob.match(/(\d+(?:\.\d+)?)\s*SEER2/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function inferItemType(row) {
  const category = normalizeLower(row.category);
  const blob = `${category} ${normalizeLower(row.subcategory_1)} ${normalizeLower(row.name)}`;
  if (category.includes('equipment')) return 'equipment';
  if (blob.includes('labor') || blob.includes('hour')) return 'labor';
  if (blob.includes('part') || blob.includes('coil') || blob.includes('filter')) return 'part';
  return 'service';
}

function inferSystemType(row) {
  const raw = normalizeText(row._system_type);
  if (raw) return raw;
  const blob = `${normalizeText(row.name)} ${normalizeText(row.subcategory_1)}`.toLowerCase();
  if (blob.includes('heat pump') || blob.includes('hp')) return 'Heat Pump';
  if (blob.includes('mini split') || blob.includes('mini-split')) return 'Mini Split';
  if (blob.includes('package')) return 'Package';
  if (blob.includes('gas split')) return 'Gas Split';
  if (blob.includes('air conditioner') || blob.includes('split ac') || blob.includes('ac')) return 'Air Conditioner';
  return '';
}

function buildSku(row) {
  const signature = [
    normalizeText(row._source_file),
    normalizeText(row.category),
    normalizeText(row.subcategory_1),
    normalizeText(row.name),
    normalizeText(row.cost),
    normalizeText(row.price),
    normalizeText(row._system_type),
    normalizeText(row._tonnage),
  ].join('|');
  const modelHint = normalizeText(row.name)
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Z0-9-]/gi, ''))
    .filter((part) => /^[A-Z0-9-]{5,}$/i.test(part))
    .filter((part) => /[A-Z]/i.test(part) && /\d/.test(part))
    .slice(-1)[0];
  if (modelHint) return `ING-${modelHint.toUpperCase()}-${stableHash(signature).slice(0, 6)}`;
  return `ING-${stableHash(signature)}`;
}

function toEstimatorCatalogItem(row, profileName = 'preferred') {
  const itemType = inferItemType(row);
  const unitCost = parseNumber(row.cost);
  if (!Number.isFinite(unitCost)) return null;

  const tonnageRaw = parseNumber(row._tonnage);
  const systemType = inferSystemType(row);
  const brand = inferBrand(row);
  const phase = inferPhase(row);
  const seer2 = inferSeer2(row);
  const vendorQuoteRequired = itemType === 'equipment' && brand && !['ac pro', 'day & night'].includes(brand.toLowerCase());

  return {
    sku: buildSku(row),
    name: normalizeText(row.name),
    itemType,
    unitCost,
    defaultLaborHours: 0,
    taxable: asBoolean(row.taxable, itemType === 'equipment'),
    features: [],
    notes: normalizeText(row.description),
    attributes: {
      brand,
      tonnage: tonnageRaw ?? '',
      seer2: seer2 ?? '',
      systemType,
      phase,
      vendorQuoteRequired,
      sourceCategory: normalizeText(row.category),
      sourceSubcategory: normalizeText(row.subcategory_1),
      sourceFile: normalizeText(row._source_file),
      importProfile: profileName,
    },
  };
}

function readJsonSafe(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallbackValue;
  }
}

function getProfileIncludeFiles(profileName) {
  const profileStore = readJsonSafe(PROFILES_JSON_PATH, { profiles: {} });
  const profile = profileStore?.profiles?.[profileName] || null;
  if (!profile) return [];
  return (profile.include || [])
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .filter((entry) => !entry.toLowerCase().endsWith('.pdf'));
}

export function getIngestReport() {
  return readJsonSafe(REPORT_JSON_PATH, null);
}

export function loadIngestedEstimatorCatalog(profileName = 'preferred') {
  const rawRows = readJsonSafe(CATALOG_JSON_PATH, []);
  if (!Array.isArray(rawRows)) return [];

  const includeFiles = getProfileIncludeFiles(profileName);
  const includeSet = new Set(includeFiles.map((file) => file.toLowerCase()));
  const filtered = includeSet.size
    ? rawRows.filter((row) => includeSet.has(normalizeText(row?._source_file).toLowerCase()))
    : rawRows;

  const dedupe = new Map();
  for (const row of filtered) {
    const normalized = toEstimatorCatalogItem(row, profileName);
    if (!normalized) continue;
    dedupe.set(normalized.sku, normalized);
  }

  return Array.from(dedupe.values());
}
