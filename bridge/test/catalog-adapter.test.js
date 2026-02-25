import test from 'node:test';
import assert from 'node:assert/strict';
import { getIngestReport, loadIngestedEstimatorCatalog } from '../imports/catalog-adapter.js';

test('catalog adapter loads preferred profile rows as estimator catalog items', () => {
  const items = loadIngestedEstimatorCatalog('preferred');
  assert.equal(Array.isArray(items), true);
  assert.equal(items.length > 0, true);

  const sample = items[0];
  assert.equal(typeof sample.sku, 'string');
  assert.equal(typeof sample.name, 'string');
  assert.equal(['equipment', 'service', 'labor', 'part'].includes(sample.itemType), true);
  assert.equal(typeof sample.unitCost, 'number');
  assert.equal(typeof sample.attributes, 'object');
  assert.equal(typeof sample.attributes.sourceFile, 'string');
});

test('catalog adapter exposes ingest report when available', () => {
  const report = getIngestReport();
  if (!report) return;
  assert.equal(typeof report, 'object');
  assert.equal(Array.isArray(report.filesProcessed), true);
});
