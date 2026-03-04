/**
 * HVAC catalog importer: read CSV/XLSX from incoming/, validate, merge, write catalog + report.
 * Run examples:
 *   node imports/ingest.js
 *   node imports/ingest.js --only CLEAN,ChangeOut_Pricebook
 *   node imports/ingest.js --profile preferred
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '..');
const SOURCE_PROFILE_PATH = path.join(BRIDGE_ROOT, 'imports', 'source-profiles.json');

const REQUIRED = ['name', 'category', 'subcategory_1', 'price', 'cost'];
const NUMERIC = ['price', 'cost'];
const TONNAGE_RE = /(\d+(?:\.\d+)?)\s*[Tt]on/;
const DEFAULT_TARGET_MARGIN = 0.4;

const HEADER_ALIASES = {
  industry: ['industry'],
  category: ['category', 'type', 'class'],
  subcategory_1: ['subcategory_1', 'subcategory 1', 'subcategory', 'sub category', 'brand', 'series'],
  name: ['name', 'item', 'equipment', 'description', 'model number', 'model'],
  description: ['description', 'details', 'notes'],
  price: ['price', 'sell', 'sell price', 'system price', 'list price'],
  cost: ['cost', 'unit cost', 'net cost', 'your cost', 'material cost'],
  taxable: ['taxable'],
  unit_of_measure: ['unit_of_measure', 'unit of measure', 'uom'],
  online_booking_enabled: ['online_booking_enabled', 'online booking enabled'],
};

const XLSX_SKIP_SHEETS = new Set([
  'title',
  'minimum efficiency standard',
  'tax credits-utility rebates',
  'filter base chart',
  'plenums',
  'sheet1',
  'paste bid here',
]);

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return `${value}`.trim();
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeHeader(value).replace(/\s+/g, '_');
}

function parseNumber(s) {
  if (s === '' || s == null) return NaN;
  const n = Number(String(s).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function roundMoney(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    dir: 'imports/incoming',
    onlyFiles: [],
    profile: '',
    profilePath: SOURCE_PROFILE_PATH,
  };

  const dirIdx = args.indexOf('--dir');
  if (dirIdx !== -1 && args[dirIdx + 1]) out.dir = args[dirIdx + 1];

  const onlyIdx = args.indexOf('--only');
  if (onlyIdx !== -1 && args[onlyIdx + 1]) {
    out.onlyFiles = args[onlyIdx + 1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const profileIdx = args.indexOf('--profile');
  if (profileIdx !== -1 && args[profileIdx + 1]) out.profile = args[profileIdx + 1].trim();

  const profilePathIdx = args.indexOf('--profile-path');
  if (profilePathIdx !== -1 && args[profilePathIdx + 1]) out.profilePath = args[profilePathIdx + 1].trim();

  return out;
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvRow(lines[i]);
    const row = {};
    header.forEach((h, j) => {
      row[h] = values[j] !== undefined ? normalizeText(values[j]) : '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvRow(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ',') {
      out.push('');
      i++;
      continue;
    }
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
    if (i >= line.length) break;
    if (line[i] === '"') {
      let end = i + 1;
      while (end < line.length) {
        const next = line.indexOf('"', end);
        if (next === -1) {
          end = line.length;
          break;
        }
        if (line[next + 1] === '"') {
          end = next + 2;
          continue;
        }
        end = next;
        break;
      }
      out.push(line.slice(i + 1, end).replace(/""/g, '"'));
      i = end + 1;
      if (i < line.length && line[i] === ',') i++;
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
      continue;
    }
    const comma = line.indexOf(',', i);
    if (comma === -1) {
      out.push(line.slice(i).trim());
      break;
    }
    out.push(line.slice(i, comma).trim());
    i = comma + 1;
  }
  return out;
}

function extractTonnage(name) {
  const m = normalizeText(name).match(TONNAGE_RE);
  return m ? m[1] : null;
}

function extractSystemType(name) {
  const n = normalizeText(name);
  if (/Heat Pump/i.test(n)) return 'Heat Pump';
  if (/Package/i.test(n)) return 'Package';
  if (/Gas Split/i.test(n)) return 'Gas Split';
  if (/Mini Split/i.test(n)) return 'Mini Split';
  if (/Air Conditioner|AC –|AC -|Split AC/i.test(n)) return 'Air Conditioner';
  return null;
}

function rowKey(row) {
  return `${normalizeText(row.category)}|${normalizeText(row.subcategory_1)}|${normalizeText(row.name)}`;
}

function resolveByAlias(indexedRow, aliases) {
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (indexedRow[key] !== undefined && normalizeText(indexedRow[key]) !== '') {
      return normalizeText(indexedRow[key]);
    }
  }
  return '';
}

function normalizeRowShape(row) {
  const indexedRow = {};
  for (const [key, value] of Object.entries(row)) {
    indexedRow[normalizeKey(key)] = normalizeText(value);
  }

  const normalized = { ...row };
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const value = resolveByAlias(indexedRow, aliases);
    if (value !== '') normalized[field] = value;
  }
  return normalized;
}

function validateRow(row) {
  const errors = [];
  const warnings = [];

  for (const field of REQUIRED) {
    if (!normalizeText(row[field])) {
      errors.push({ field, message: `Missing required: ${field}` });
    }
  }

  for (const field of NUMERIC) {
    const parsed = parseNumber(row[field]);
    if (Number.isNaN(parsed)) {
      errors.push({ field, message: `Invalid number: ${field}="${row[field] ?? ''}"` });
    } else if (parsed < 0) {
      errors.push({ field, message: `Negative value: ${field}=${parsed}` });
    }
  }

  const price = parseNumber(row.price);
  const cost = parseNumber(row.cost);
  if (!Number.isNaN(price) && !Number.isNaN(cost) && cost > price) {
    warnings.push({ message: `Cost (${cost}) > price (${price})` });
  }

  if (
    normalizeText(row.category).toUpperCase().includes('EQUIPMENT') &&
    !extractTonnage(row.name)
  ) {
    warnings.push({ message: 'Equipment row: no tonnage parsed from name' });
  }
  if (
    normalizeText(row.category).toUpperCase().includes('EQUIPMENT') &&
    !extractSystemType(row.name)
  ) {
    warnings.push({ message: 'Equipment row: no system type (Heat Pump / AC / Package) parsed from name' });
  }

  return { errors, warnings };
}

function loadSourceProfiles(profilePath) {
  const absolute = path.isAbsolute(profilePath) ? profilePath : path.join(BRIDGE_ROOT, profilePath);
  if (!fs.existsSync(absolute)) return { profiles: {} };
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (_) {
    return { profiles: {} };
  }
}

function shouldIncludeFile(fileName, filters = []) {
  if (!filters.length) return true;
  const lower = fileName.toLowerCase();
  return filters.some((token) => lower.includes(token.toLowerCase()));
}

function collectSourceFiles(dir, options = {}) {
  const dirPath = path.isAbsolute(dir) ? dir : path.join(BRIDGE_ROOT, dir);
  if (!fs.existsSync(dirPath)) return [];

  const allFiles = fs.readdirSync(dirPath).filter((f) => !f.startsWith('.'));
  const includeFilters = options.includeFilters || [];
  const onlyFilters = options.onlyFilters || [];

  return allFiles
    .filter((file) => shouldIncludeFile(file, includeFilters))
    .filter((file) => shouldIncludeFile(file, onlyFilters))
    .map((file) => ({
      file,
      filePath: path.join(dirPath, file),
      ext: path.extname(file).toLowerCase(),
    }));
}

function pickColumnIndex(headers, candidates) {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function inferSystemTypeFromSheet(sheetName) {
  const s = normalizeText(sheetName);
  if (/Heat Pump|HP Split/i.test(s)) return 'Heat Pump';
  if (/Gas Split/i.test(s)) return 'Gas Split';
  if (/Package/i.test(s)) return 'Package';
  if (/Mini Split/i.test(s)) return 'Mini Split';
  if (/AC/i.test(s)) return 'Air Conditioner';
  return '';
}

function parseRowsFromXlsxSheet(matrix, sheetName, options = {}) {
  const rows = matrix.map((r) => (Array.isArray(r) ? r.map((v) => normalizeText(v)) : []));
  const normalizedSheetName = normalizeText(sheetName);
  if (!normalizedSheetName) return [];

  const skipSheets = new Set((options.ignoreSheets || []).map((s) => s.toLowerCase()));
  if (skipSheets.has(normalizedSheetName.toLowerCase())) return [];

  let headerRowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const header = rows[i].map((v) => normalizeHeader(v));
    const hasPrice = header.some((h) => h.includes('price'));
    const hasIdentity = header.some((h) => h.includes('model') || h.includes('condenser') || h.includes('tonnage'));
    if (hasPrice && hasIdentity) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) return [];

  const header = rows[headerRowIndex].map((v) => normalizeHeader(v));
  const tonnageIdx = pickColumnIndex(header, ['tonnage', 'size']);
  const modelIdx = pickColumnIndex(header, ['model number', 'model', 'condenser']);
  const ahriIdx = pickColumnIndex(header, ['ahri']);
  const notesIdx = pickColumnIndex(header, ['notes']);
  const coolingIdx = pickColumnIndex(header, ['clg btus', 'cooling capacity', 'btuh']);
  const systemPriceIdx = pickColumnIndex(header, ['system price']);
  const priceIndices = header
    .map((h, idx) => (h === 'price' || h.endsWith(' price') ? idx : -1))
    .filter((idx) => idx !== -1);

  const targetMargin = Number.isFinite(options.targetMargin) ? options.targetMargin : DEFAULT_TARGET_MARGIN;
  const costMode = options.defaultCostMode || 'cost_only';
  const subcategoryPrefix = options.defaultSubcategoryPrefix || 'DAY & NIGHT';
  const category = options.defaultCategory || 'EQUIPMENT';
  const blankBreakThreshold = Number.isFinite(options.breakAfterBlankRows) ? options.breakAfterBlankRows : 30;

  const parsed = [];
  let blankRows = 0;

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const isBlank = row.every((value) => !normalizeText(value));
    if (isBlank) {
      blankRows += 1;
      if (blankRows >= blankBreakThreshold) break;
      continue;
    }
    blankRows = 0;

    let tonnage = tonnageIdx >= 0 ? normalizeText(row[tonnageIdx]) : '';
    const model = modelIdx >= 0 ? normalizeText(row[modelIdx]) : '';
    const notes = notesIdx >= 0 ? normalizeText(row[notesIdx]) : '';
    const ahri = ahriIdx >= 0 ? normalizeText(row[ahriIdx]) : '';
    const coolingBtus = coolingIdx >= 0 ? parseNumber(row[coolingIdx]) : NaN;
    if (!tonnage && Number.isFinite(coolingBtus) && coolingBtus > 0) {
      tonnage = `${Math.round((coolingBtus / 12000) * 10) / 10}`;
    }

    let baseValue = systemPriceIdx >= 0 ? parseNumber(row[systemPriceIdx]) : NaN;
    if (Number.isNaN(baseValue) && priceIndices.length) {
      const prices = priceIndices.map((idx) => parseNumber(row[idx])).filter((n) => Number.isFinite(n));
      if (prices.length) {
        baseValue = prices.reduce((sum, value) => sum + value, 0);
      }
    }
    if (Number.isNaN(baseValue)) continue;

    let cost = baseValue;
    let price = baseValue;
    if (costMode === 'cost_only') {
      cost = baseValue;
      price = roundMoney(baseValue / (1 - targetMargin));
    } else if (costMode === 'sell_only') {
      price = baseValue;
      cost = roundMoney(baseValue * (1 - targetMargin));
    }

    const systemType = inferSystemTypeFromSheet(normalizedSheetName);
    const nameParts = [];
    if (tonnage) nameParts.push(`${tonnage} Ton`);
    if (systemType) nameParts.push(systemType);
    if (model) nameParts.push(model);
    const generatedName = nameParts.join(' ').trim();
    if (!generatedName) continue;

    parsed.push({
      industry: 'Heating and Air Conditioning',
      category,
      subcategory_1: `${subcategoryPrefix} - ${normalizedSheetName}`,
      name: generatedName,
      description: [model ? `Model: ${model}` : '', ahri ? `AHRI: ${ahri}` : '', notes].filter(Boolean).join(' | '),
      price: `${price}`,
      cost: `${cost}`,
      taxable: 'true',
      unit_of_measure: 'Each',
      online_booking_enabled: 'false',
      _source_sheet: normalizedSheetName,
    });
  }

  return parsed;
}

function parseXlsxWorkbook(filePath, options = {}) {
  const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false });
  const allRows = [];
  const sheetStats = {};

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    const rows = parseRowsFromXlsxSheet(matrix, sheetName, options);
    sheetStats[sheetName] = rows.length;
    allRows.push(...rows);
  }

  return { rows: allRows, sheetStats };
}

function run() {
  const args = parseArgs();
  const profileStore = loadSourceProfiles(args.profilePath);
  const selectedProfile = args.profile ? profileStore.profiles?.[args.profile] || null : null;

  const includeFilters = selectedProfile?.include || [];
  const manualReferenceOnly = new Set((selectedProfile?.manual_reference_only || []).map((f) => f.toLowerCase()));
  const xlsxOptions = {
    targetMargin: Number(selectedProfile?.xlsx?.target_margin ?? DEFAULT_TARGET_MARGIN),
    defaultCostMode: selectedProfile?.xlsx?.default_cost_mode || 'cost_only',
    defaultCategory: selectedProfile?.xlsx?.default_category || 'EQUIPMENT',
    defaultSubcategoryPrefix: selectedProfile?.xlsx?.default_subcategory_prefix || 'DAY & NIGHT',
    ignoreSheets: selectedProfile?.xlsx?.ignore_sheets || Array.from(XLSX_SKIP_SHEETS),
    breakAfterBlankRows: Number(selectedProfile?.xlsx?.break_after_blank_rows ?? 30),
  };

  const sourceFiles = collectSourceFiles(args.dir, {
    includeFilters,
    onlyFilters: args.onlyFiles,
  });

  const report = {
    generated: new Date().toISOString(),
    sourceDir: args.dir,
    profile: args.profile || null,
    filesProcessed: [],
    manualReferences: [],
    totalRows: 0,
    validRows: 0,
    errors: [],
    warnings: [],
    duplicates: [],
    byFile: {},
  };

  const seenKeys = new Set();
  const catalog = [];

  for (const source of sourceFiles) {
    const lowerFile = source.file.toLowerCase();
    if (manualReferenceOnly.has(lowerFile) || source.ext === '.pdf') {
      report.manualReferences.push({
        file: source.file,
        path: source.filePath,
        mode: 'reference_only',
      });
      continue;
    }

    let rows = [];
    let extra = {};
    try {
      if (source.ext === '.csv') {
        const parsed = parseCsv(fs.readFileSync(source.filePath, 'utf8'));
        rows = parsed.map((row) => normalizeRowShape(row));
      } else if (source.ext === '.xlsx') {
        const parsed = parseXlsxWorkbook(source.filePath, xlsxOptions);
        rows = parsed.rows.map((row) => normalizeRowShape(row));
        extra = { sheetStats: parsed.sheetStats };
      } else {
        report.manualReferences.push({
          file: source.file,
          path: source.filePath,
          mode: 'unsupported_extension',
        });
        continue;
      }
    } catch (err) {
      report.errors.push({
        file: source.file,
        row: null,
        name: '',
        field: 'file',
        message: `Failed to parse file: ${err.message}`,
      });
      continue;
    }

    const fileReport = {
      file: source.file,
      extension: source.ext,
      rowsRead: rows.length,
      errors: [],
      warnings: [],
      duplicates: [],
      ...extra,
    };
    report.filesProcessed.push(source.file);
    report.byFile[source.file] = fileReport;
    report.totalRows += rows.length;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const { errors, warnings } = validateRow(row);
      const rowNumber = i + 2;

      for (const error of errors) {
        report.errors.push({ file: source.file, row: rowNumber, name: row.name, ...error });
        fileReport.errors.push({ row: rowNumber, ...error });
      }
      for (const warning of warnings) {
        report.warnings.push({ file: source.file, row: rowNumber, name: row.name, ...warning });
        fileReport.warnings.push({ row: rowNumber, ...warning });
      }
      if (errors.length > 0) continue;

      const key = rowKey(row);
      if (seenKeys.has(key)) {
        const duplicate = { file: source.file, row: rowNumber, name: row.name, key };
        report.duplicates.push(duplicate);
        fileReport.duplicates.push({ row: rowNumber, name: row.name });
        continue;
      }
      seenKeys.add(key);

      const price = parseNumber(row.price);
      const cost = parseNumber(row.cost);
      catalog.push({
        ...row,
        price: Number.isFinite(price) ? price : null,
        cost: Number.isFinite(cost) ? cost : null,
        _tonnage: extractTonnage(row.name),
        _system_type: extractSystemType(row.name),
        _source_file: source.file,
      });
      report.validRows += 1;
    }
  }

  const catalogDir = path.join(BRIDGE_ROOT, 'imports', 'catalog');
  const reportPath = path.join(BRIDGE_ROOT, 'imports', 'validation-report.json');
  if (!fs.existsSync(catalogDir)) fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(path.join(catalogDir, 'equipment-and-adders.json'), JSON.stringify(catalog, null, 2), 'utf8');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('Ingest complete.');
  console.log('  Profile:', report.profile || '(none)');
  console.log('  Files:', report.filesProcessed.length);
  console.log('  Manual references:', report.manualReferences.length);
  console.log('  Rows read:', report.totalRows);
  console.log('  Valid in catalog:', report.validRows);
  console.log('  Errors:', report.errors.length);
  console.log('  Warnings:', report.warnings.length);
  console.log('  Duplicates skipped:', report.duplicates.length);
  console.log('  Catalog:', path.join(catalogDir, 'equipment-and-adders.json'));
  console.log('  Report:', reportPath);

  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

run();
