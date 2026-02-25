/**
 * HVAC catalog importer: read CSV from incoming/, validate, merge, write catalog + report.
 * Run: node imports/ingest.js [--dir imports/incoming]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(BRIDGE_ROOT, '..');

const REQUIRED = ['name', 'category', 'subcategory_1', 'price', 'cost'];
const NUMERIC = ['price', 'cost'];
const TONNAGE_RE = /(\d+(?:\.\d+)?)\s*[Tt]on/;

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const row = {};
    header.forEach((h, j) => {
      row[h] = values[j] !== undefined ? String(values[j]).trim() : '';
    });
    rows.push(row);
  }
  return rows;
}

function parseRow(line) {
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
    } else {
      const comma = line.indexOf(',', i);
      if (comma === -1) {
        out.push(line.slice(i).trim());
        break;
      }
      out.push(line.slice(i, comma).trim());
      i = comma + 1;
    }
  }
  return out;
}

function parseNumber(s) {
  if (s === '' || s == null) return NaN;
  const n = Number(String(s).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function extractTonnage(name) {
  const m = (name || '').match(TONNAGE_RE);
  return m ? m[1] : null;
}

function extractSystemType(name) {
  const n = (name || '');
  if (/Heat Pump/i.test(n)) return 'Heat Pump';
  if (/Package/i.test(n)) return 'Package';
  if (/Air Conditioner|AC –|AC -/i.test(n)) return 'Air Conditioner';
  return null;
}

function rowKey(row) {
  return `${(row.category || '').trim()}|${(row.subcategory_1 || '').trim()}|${(row.name || '').trim()}`;
}

function validateRow(row, sourceFile, rowIndex) {
  const errors = [];
  const warnings = [];

  for (const f of REQUIRED) {
    const v = row[f];
    if (v === undefined || v === null || String(v).trim() === '') {
      errors.push({ field: f, message: `Missing required: ${f}` });
    }
  }

  for (const f of NUMERIC) {
    const v = row[f];
    const n = parseNumber(v);
    if (Number.isNaN(n)) {
      errors.push({ field: f, message: `Invalid number: ${f}="${v}"` });
    } else if (n < 0) {
      errors.push({ field: f, message: `Negative value: ${f}=${n}` });
    }
  }

  const price = parseNumber(row.price);
  const cost = parseNumber(row.cost);
  if (!Number.isNaN(price) && !Number.isNaN(cost) && cost > price) {
    warnings.push({ message: `Cost (${cost}) > price (${price})` });
  }

  if (row.category === 'EQUIPMENT' || (row.category && row.category.toUpperCase().includes('EQUIPMENT'))) {
    const tonnage = extractTonnage(row.name);
    const systemType = extractSystemType(row.name);
    if (!tonnage) warnings.push({ message: 'Equipment row: no tonnage parsed from name' });
    if (!systemType) warnings.push({ message: 'Equipment row: no system type (Heat Pump / AC / Package) parsed from name' });
  }

  return { errors, warnings };
}

function readAllCsv(dir, onlyFiles) {
  const dirPath = path.isAbsolute(dir) ? dir : path.join(BRIDGE_ROOT, dir);
  if (!fs.existsSync(dirPath)) return [];

  let files = fs.readdirSync(dirPath).filter((f) => f.toLowerCase().endsWith('.csv'));
  if (onlyFiles && onlyFiles.length > 0) {
    const allow = onlyFiles.map((f) => f.toLowerCase());
    files = files.filter((f) => allow.some((a) => f.toLowerCase().includes(a)));
  }
  const out = [];
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const rows = parseCsv(content);
    out.push({ file, path: filePath, rows });
  }
  return out;
}

function run() {
  const args = process.argv.slice(2);
  let dir = 'imports/incoming';
  const dirIdx = args.indexOf('--dir');
  if (dirIdx !== -1 && args[dirIdx + 1]) dir = args[dirIdx + 1];
  const onlyIdx = args.indexOf('--only');
  const onlyFiles = onlyIdx !== -1 && args[onlyIdx + 1] ? args[onlyIdx + 1].split(',').map((s) => s.trim()) : [];

  const sources = readAllCsv(dir, onlyFiles);
  const report = {
    generated: new Date().toISOString(),
    sourceDir: dir,
    filesProcessed: [],
    totalRows: 0,
    validRows: 0,
    errors: [],
    warnings: [],
    duplicates: [],
    byFile: {},
  };

  const seenKeys = new Set();
  const catalog = [];

  for (const { file, path: filePath, rows } of sources) {
    const fileReport = { file, rowsRead: rows.length, errors: [], warnings: [], duplicates: [] };
    report.filesProcessed.push(file);
    report.byFile[file] = fileReport;
    report.totalRows += rows.length;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const { errors, warnings } = validateRow(row, file, i + 2);

      for (const e of errors) {
        report.errors.push({ file, row: i + 2, name: row.name, ...e });
        fileReport.errors.push({ row: i + 2, ...e });
      }
      for (const w of warnings) {
        report.warnings.push({ file, row: i + 2, name: row.name, ...w });
        fileReport.warnings.push({ row: i + 2, ...w });
      }

      if (errors.length > 0) continue;

      const key = rowKey(row);
      if (seenKeys.has(key)) {
        report.duplicates.push({ file, row: i + 2, name: row.name, key });
        fileReport.duplicates.push({ row: i + 2, name: row.name });
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
        _source_file: file,
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
  console.log('  Files:', report.filesProcessed.length);
  console.log('  Rows read:', report.totalRows);
  console.log('  Valid in catalog:', report.validRows);
  console.log('  Errors:', report.errors.length);
  console.log('  Warnings:', report.warnings.length);
  console.log('  Duplicates skipped:', report.duplicates.length);
  console.log('  Catalog:', path.join(catalogDir, 'equipment-and-adders.json'));
  console.log('  Report:', reportPath);
}

run();
