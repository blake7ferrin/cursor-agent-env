/**
 * MCP adapter: Catalog / pricebook (ingested equipment and adders).
 * Wraps imports/catalog-adapter.js for read/query access.
 * Used by estimator routes and (later) by an MCP server exposing catalog as a tool.
 */

import {
  getIngestReport as getIngestReportImpl,
  loadIngestedEstimatorCatalog as loadIngestedEstimatorCatalogImpl,
} from '../imports/catalog-adapter.js';

/**
 * Get the last ingest validation report (profile, files processed, errors).
 * @returns {object | null}
 */
export function getIngestReport() {
  return getIngestReportImpl();
}

/**
 * Load catalog items for a profile (e.g. 'preferred'). Returns estimator-shaped items (sku, name, itemType, unitCost, attributes, etc.).
 * @param {string} [profileName='preferred']
 * @returns {Array<object>}
 */
export function loadCatalog(profileName = 'preferred') {
  return loadIngestedEstimatorCatalogImpl(profileName);
}

/**
 * Query catalog by SKU. Returns the first matching item or null.
 * @param {string} sku
 * @param {string} [profileName='preferred']
 * @returns {object | null}
 */
export function getItemBySku(sku, profileName = 'preferred') {
  if (!sku || typeof sku !== 'string') return null;
  const catalog = loadCatalog(profileName);
  return catalog.find((item) => (item.sku || '').toLowerCase() === sku.trim().toLowerCase()) ?? null;
}

/**
 * Simple filter by attribute (e.g. brand, systemType). Returns items whose attributes match the given key/value.
 * @param {string} attributeKey
 * @param {string | number | boolean} value
 * @param {string} [profileName='preferred']
 * @returns {Array<object>}
 */
export function queryByAttribute(attributeKey, value, profileName = 'preferred') {
  if (!attributeKey || value === undefined) return [];
  const catalog = loadCatalog(profileName);
  const normalized = `${value}`.trim().toLowerCase();
  return catalog.filter((item) => {
    const attrs = item.attributes || {};
    const v = attrs[attributeKey];
    if (v === undefined || v === null) return false;
    return `${v}`.trim().toLowerCase() === normalized;
  });
}
