import { randomUUID } from 'node:crypto';
import {
  EstimatorValidationError,
  getDefaultEstimatorConfig,
  normalizeRate,
} from './estimator-domain.js';
import { getBrandingProfile } from './branding/polar-air.js';

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRate(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function toNonNegativeNumber(value, fieldName, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new EstimatorValidationError(`${fieldName} must be a non-negative number`);
  }
  return numeric;
}

function toPositiveNumber(value, fieldName, defaultValue = 1) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new EstimatorValidationError(`${fieldName} must be greater than zero`);
  }
  return numeric;
}

function asTrimmedString(value, fieldName, options = {}) {
  const { defaultValue = '', maxLength = 240 } = options;
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value !== 'string') throw new EstimatorValidationError(`${fieldName} must be a string`);
  return value.trim().slice(0, maxLength);
}

function computeLine({
  code,
  name,
  itemType,
  quantity,
  unitCost,
  laborHoursPerUnit,
  taxable,
  config,
  targetMargin,
  notes = '',
  features = [],
}) {
  const materialCost = unitCost * quantity;
  const laborHours = laborHoursPerUnit * quantity;
  const laborCost = laborHours * config.laborRatePerHour;
  const laborBurdenCost = laborCost * config.laborBurdenRate;
  const directCost = materialCost + laborCost + laborBurdenCost;
  const overheadCost = directCost * config.overheadRate;
  const contingencyCost = directCost * config.contingencyRate;
  const totalCost = directCost + overheadCost + contingencyCost;
  const targetSell = totalCost / (1 - targetMargin);

  return {
    code,
    name,
    itemType,
    quantity: roundRate(quantity),
    unitCost: roundMoney(unitCost),
    laborHoursPerUnit: roundRate(laborHoursPerUnit),
    laborHours: roundRate(laborHours),
    taxable,
    notes,
    features,
    costs: {
      materialCost: roundMoney(materialCost),
      laborCost: roundMoney(laborCost),
      laborBurdenCost: roundMoney(laborBurdenCost),
      overheadCost: roundMoney(overheadCost),
      contingencyCost: roundMoney(contingencyCost),
      totalCost: roundMoney(totalCost),
      targetSellPrice: roundMoney(targetSell),
    },
    _raw: {
      totalCost,
      targetSell,
      taxable,
    },
  };
}

function normalizeManualLine(item, index) {
  if (!item || typeof item !== 'object') {
    throw new EstimatorValidationError(`manual_items[${index}] must be an object`);
  }
  const name = asTrimmedString(item.name, `manual_items[${index}].name`);
  const code = asTrimmedString(item.code, `manual_items[${index}].code`, {
    defaultValue: `manual-${index + 1}`,
    maxLength: 120,
  });
  const quantity = toPositiveNumber(item.quantity, `manual_items[${index}].quantity`, 1);
  const unitCost = toNonNegativeNumber(item.unitCost, `manual_items[${index}].unitCost`, 0);
  const laborHoursPerUnit = toNonNegativeNumber(
    item.laborHoursPerUnit,
    `manual_items[${index}].laborHoursPerUnit`,
    0,
  );
  const itemType = asTrimmedString(item.itemType, `manual_items[${index}].itemType`, {
    defaultValue: 'service',
    maxLength: 40,
  }).toLowerCase();
  const taxable = item.taxable === undefined ? true : Boolean(item.taxable);
  const notes = asTrimmedString(item.notes, `manual_items[${index}].notes`, {
    defaultValue: '',
    maxLength: 500,
  });
  const features = Array.isArray(item.features)
    ? item.features
        .filter((feature) => typeof feature === 'string' && feature.trim())
        .map((feature) => feature.trim().slice(0, 200))
    : [];

  return {
    code,
    name,
    quantity,
    unitCost,
    laborHoursPerUnit,
    itemType,
    taxable,
    notes,
    features,
  };
}

function escapeHtml(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(isoOrText) {
  if (!isoOrText) return '';
  const parsed = new Date(isoOrText);
  if (Number.isNaN(parsed.getTime())) return String(isoOrText);
  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: '2-digit',
    year: 'numeric',
  });
}

function listItemsToHtml(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
}

function formatNumber(value, decimals = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function newBuildSummaryToHtml(estimate) {
  const summary = estimate?.new_build;
  if (!summary || typeof summary !== 'object') return '';
  const subtotals = summary.sectionInputSubtotals || {};
  const systems = Array.isArray(summary.systems) ? summary.systems : [];
  const systemsHtml = systems.length
    ? systems
      .map((system) => `<li>${escapeHtml(system.systemId || 'System')} — ${escapeHtml(system.equipmentType || 'system')} (${formatNumber(system.tonnage, 1)} ton, ${escapeHtml(system.heatType || 'electric')})</li>`)
      .join('')
    : '<li>System details not provided</li>';

  return `
    <section class="section">
      <h2>New Build Breakdown</h2>
      <table class="kv">
        <tr><td>Estimate Type</td><td>New Build</td></tr>
        <tr><td>Pricing Mode</td><td>${escapeHtml(summary.pricingMode || estimate?.pricing_mode || 'standard')}</td></tr>
        <tr><td>Equipment Subtotal</td><td>${formatMoney(Number(subtotals.equipment || 0), estimate.currency)}</td></tr>
        <tr><td>Air Distribution Subtotal</td><td>${formatMoney(Number(subtotals.airDistribution || 0), estimate.currency)}</td></tr>
        <tr><td>Ventilation Subtotal</td><td>${formatMoney(Number(subtotals.ventilation || 0), estimate.currency)}</td></tr>
        <tr><td>Adders Subtotal</td><td>${formatMoney(Number(subtotals.adders || 0), estimate.currency)}</td></tr>
        <tr><td>Cost Subtotal</td><td>${formatMoney(Number(subtotals.jobCostSubtotal || 0), estimate.currency)}</td></tr>
        <tr><td>Final Selling Price</td><td>${formatMoney(Number(estimate?.totals?.grandTotal || 0), estimate.currency)}</td></tr>
      </table>
      <div class="copy">
        <p><strong>System Summary:</strong></p>
        <ul>${systemsHtml}</ul>
      </div>
    </section>
  `;
}

function estimateOptionsToHtml(estimate) {
  const taxRate = Number(estimate?.totals?.taxRate || 0);
  const rows = (Array.isArray(estimate?.line_items) ? estimate.line_items : [])
    .map((line, index) => {
      const subtotal = Number(line?.costs?.targetSellPrice || 0);
      const tax = line?.taxable ? subtotal * taxRate : 0;
      const total = subtotal + tax;
      const optionName = String.fromCharCode(65 + (index % 26));
      const features = Array.isArray(line?.features) && line.features.length
        ? `<div class="features">${escapeHtml(line.features.join(' | '))}</div>`
        : '';
      return `
        <tr>
          <td class="option">${optionName}</td>
          <td>${escapeHtml(line?.name || '')}${features}</td>
          <td>${escapeHtml(line?.code || '')}</td>
          <td>${escapeHtml(line?.itemType || 'service')}</td>
          <td class="right">${formatMoney(subtotal, estimate.currency)}</td>
          <td class="right">${formatMoney(total, estimate.currency)}</td>
        </tr>
      `;
    })
    .join('');

  return rows || `
    <tr>
      <td class="option">A</td>
      <td>No options found</td>
      <td>-</td>
      <td>-</td>
      <td class="right">${formatMoney(0, estimate.currency)}</td>
      <td class="right">${formatMoney(0, estimate.currency)}</td>
    </tr>
  `;
}

export function buildEstimate(input = {}) {
  const catalog = Array.isArray(input.catalog) ? input.catalog : [];
  const catalogBySku = new Map(catalog.map((item) => [item.sku, item]));
  const config = {
    ...getDefaultEstimatorConfig(),
    ...(input.config || {}),
  };

  const selections = Array.isArray(input.selections) ? input.selections : [];
  const manualItems = Array.isArray(input.manual_items) ? input.manual_items : [];
  if (!selections.length && !manualItems.length) {
    throw new EstimatorValidationError('At least one selection or manual item is required');
  }

  const adjustments = input.adjustments && typeof input.adjustments === 'object' ? input.adjustments : {};
  const targetMargin = normalizeRate(
    adjustments.targetGrossMarginOverride ?? config.targetGrossMargin,
    'targetGrossMargin',
    { max: 0.95, defaultValue: config.targetGrossMargin },
  );
  const minimumMarginTarget = normalizeRate(
    adjustments.minimumGrossMarginOverride ?? config.minimumGrossMargin ?? targetMargin,
    'minimumGrossMargin',
    { max: 0.95, defaultValue: config.minimumGrossMargin ?? targetMargin },
  );
  const taxRate = normalizeRate(adjustments.taxRate ?? config.defaultTaxRate, 'taxRate', {
    max: 1,
    defaultValue: config.defaultTaxRate,
  });
  const discountPercent = normalizeRate(adjustments.discountPercent, 'discountPercent', {
    max: 1,
    defaultValue: 0,
  });
  const discountAmount = toNonNegativeNumber(adjustments.discountAmount, 'discountAmount', 0);
  const permitFee = toNonNegativeNumber(adjustments.permitFee, 'permitFee', config.defaultPermitFee);
  const tripCharge = toNonNegativeNumber(adjustments.tripCharge, 'tripCharge', config.defaultTripCharge);

  const lineItems = [];

  selections.forEach((selection, index) => {
    if (!selection || typeof selection !== 'object') {
      throw new EstimatorValidationError(`selections[${index}] must be an object`);
    }
    const sku = asTrimmedString(selection.sku, `selections[${index}].sku`, { maxLength: 120 });
    const catalogItem = catalogBySku.get(sku);
    if (!catalogItem) {
      throw new EstimatorValidationError(`Unknown SKU in selections[${index}]: ${sku}`);
    }
    const quantity = toPositiveNumber(selection.quantity, `selections[${index}].quantity`, 1);
    const unitCost = toNonNegativeNumber(
      selection.unitCostOverride,
      `selections[${index}].unitCostOverride`,
      catalogItem.unitCost,
    );
    const laborHoursPerUnit = toNonNegativeNumber(
      selection.laborHoursPerUnitOverride,
      `selections[${index}].laborHoursPerUnitOverride`,
      catalogItem.defaultLaborHours,
    );
    const notes = asTrimmedString(selection.notes, `selections[${index}].notes`, {
      defaultValue: catalogItem.notes || '',
      maxLength: 500,
    });
    lineItems.push(
      computeLine({
        code: sku,
        name: catalogItem.name,
        itemType: catalogItem.itemType,
        quantity,
        unitCost,
        laborHoursPerUnit,
        taxable: catalogItem.taxable,
        config,
        targetMargin,
        notes,
        features: catalogItem.features || [],
      }),
    );
  });

  manualItems.forEach((item, index) => {
    const normalized = normalizeManualLine(item, index);
    lineItems.push(
      computeLine({
        code: normalized.code,
        name: normalized.name,
        itemType: normalized.itemType,
        quantity: normalized.quantity,
        unitCost: normalized.unitCost,
        laborHoursPerUnit: normalized.laborHoursPerUnit,
        taxable: normalized.taxable,
        config,
        targetMargin,
        notes: normalized.notes,
        features: normalized.features,
      }),
    );
  });

  const lineRawCost = lineItems.reduce((sum, line) => sum + line._raw.totalCost, 0);
  const fixedCosts = permitFee + tripCharge;
  const totalCost = lineRawCost + fixedCosts;
  const recommendedSubtotal = totalCost / (1 - targetMargin);
  const discountFromPercent = recommendedSubtotal * discountPercent;
  let discountTotal = Math.min(recommendedSubtotal, discountFromPercent + discountAmount);
  let subtotalAfterDiscount = recommendedSubtotal - discountTotal;
  const minimumAllowedSubtotal = totalCost / (1 - minimumMarginTarget);
  const autoRaiseToMinimumGrossMargin = adjustments.autoRaiseToMinimumGrossMargin === true;
  let adjustedToMinimumGrossMargin = false;
  if (subtotalAfterDiscount < minimumAllowedSubtotal && autoRaiseToMinimumGrossMargin) {
    subtotalAfterDiscount = minimumAllowedSubtotal;
    discountTotal = Math.max(0, recommendedSubtotal - subtotalAfterDiscount);
    adjustedToMinimumGrossMargin = true;
  }
  const belowMinimumGrossMargin = subtotalAfterDiscount < minimumAllowedSubtotal - 0.01;

  const taxableRatio =
    lineItems.length === 0
      ? 1
      : lineItems.reduce((sum, line) => sum + (line._raw.taxable ? line._raw.targetSell : 0), 0) /
        lineItems.reduce((sum, line) => sum + line._raw.targetSell, 0);
  const taxableSubtotal = subtotalAfterDiscount * (Number.isFinite(taxableRatio) ? taxableRatio : 1);
  const taxTotal = taxableSubtotal * taxRate;
  const grandTotal = subtotalAfterDiscount + taxTotal;

  const grossProfit = subtotalAfterDiscount - totalCost;
  const achievedGrossMargin = subtotalAfterDiscount <= 0 ? 0 : grossProfit / subtotalAfterDiscount;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + Number(config.estimateExpirationDays || 30));

  const alerts = [];
  if (achievedGrossMargin < targetMargin) {
    alerts.push('Estimated gross margin is below target after discounts.');
  }
  if (belowMinimumGrossMargin) {
    alerts.push('Estimated gross margin is below configured minimum guardrail.');
  }
  if (adjustedToMinimumGrossMargin) {
    alerts.push('Subtotal was automatically raised to satisfy minimum gross margin guardrail.');
  }
  if (config.enforceMinimumGrossMargin && belowMinimumGrossMargin && adjustments.allowMarginOverride !== true) {
    throw new EstimatorValidationError(
      'Estimate subtotal is below minimum gross margin guardrail. Set allowMarginOverride=true or adjust pricing.',
      {
        minimumAllowedSubtotal: roundMoney(minimumAllowedSubtotal),
        achievedGrossMargin: roundRate(achievedGrossMargin),
        minimumGrossMarginTarget: roundRate(minimumMarginTarget),
      },
    );
  }

  for (const line of lineItems) {
    delete line._raw;
  }

  return {
    estimate_id: `est_${randomUUID()}`,
    generated_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    currency: config.currency,
    customer: input.customer && typeof input.customer === 'object' ? input.customer : {},
    project: input.project && typeof input.project === 'object' ? input.project : {},
    assumptions: {
      laborRatePerHour: roundMoney(config.laborRatePerHour),
      laborBurdenRate: roundRate(config.laborBurdenRate),
      overheadRate: roundRate(config.overheadRate),
      contingencyRate: roundRate(config.contingencyRate),
      targetGrossMargin: roundRate(targetMargin),
      minimumGrossMargin: roundRate(minimumMarginTarget),
      enforceMinimumGrossMargin: Boolean(config.enforceMinimumGrossMargin),
      defaultTaxRate: roundRate(taxRate),
      paymentTerms: config.paymentTerms,
    },
    line_items: lineItems,
    additional_costs: {
      permitFee: roundMoney(permitFee),
      tripCharge: roundMoney(tripCharge),
    },
    totals: {
      directCostWithOverhead: roundMoney(totalCost),
      recommendedSubtotal: roundMoney(recommendedSubtotal),
      discountTotal: roundMoney(discountTotal),
      subtotalAfterDiscount: roundMoney(subtotalAfterDiscount),
      minimumAllowedSubtotal: roundMoney(minimumAllowedSubtotal),
      taxableSubtotal: roundMoney(taxableSubtotal),
      taxRate: roundRate(taxRate),
      taxTotal: roundMoney(taxTotal),
      grandTotal: roundMoney(grandTotal),
      grossProfit: roundMoney(grossProfit),
      achievedGrossMargin: roundRate(achievedGrossMargin),
      minimumGrossMarginTarget: roundRate(minimumMarginTarget),
    },
    alerts,
    guardrails: {
      autoRaiseToMinimumGrossMargin,
      adjustedToMinimumGrossMargin,
      belowMinimumGrossMargin,
      allowMarginOverride: adjustments.allowMarginOverride === true,
    },
    crm_payload: {
      estimateId: `est_${Date.now()}`,
      customerName: input.customer?.name || '',
      subtotal: roundMoney(subtotalAfterDiscount),
      tax: roundMoney(taxTotal),
      total: roundMoney(grandTotal),
      expiresAt: expiresAt.toISOString(),
    },
  };
}

export function renderEstimateHtml(estimate) {
  const brand = getBrandingProfile();
  const estimateType = escapeHtml(estimate?.estimate_type || estimate?.project?.estimateType || 'changeout');
  const pricingMode = escapeHtml(estimate?.pricing_mode || estimate?.project?.pricing_mode || 'standard');
  const customerName = escapeHtml(estimate?.customer?.name || estimate?.customer?.customer_name || 'Customer');
  const propertyAddress = escapeHtml(
    estimate?.project?.address || estimate?.customer?.address || estimate?.project?.property_address || 'Not provided',
  );
  const phone = escapeHtml(estimate?.customer?.phone || estimate?.customer?.phone_number || 'Not provided');
  const email = escapeHtml(estimate?.customer?.email || 'Not provided');
  const issueDate = escapeHtml(formatDate(estimate?.generated_at));
  const expiresDate = escapeHtml(formatDate(estimate?.expires_at));
  const preparedBy = escapeHtml(estimate?.project?.prepared_by || brand.companyName);
  const scopeSummary = escapeHtml(estimate?.project?.summary || brand.defaultScopeSummary);
  const proposalId = escapeHtml(estimate?.project?.proposal_id || estimate?.estimate_id || '');
  const includeProposalId = proposalId && !proposalId.startsWith('est_');
  const optionsRows = estimateOptionsToHtml(estimate);
  const newBuildSection = newBuildSummaryToHtml(estimate);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(brand.proposalTitle)} - ${escapeHtml(estimate?.estimate_id || '')}</title>
  <style>
    :root {
      --ink: #111827;
      --muted: #6b7280;
      --line: #d1d5db;
      --panel: #f3f4f6;
      --brand: #0f172a;
      --accent: #1f2937;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      line-height: 1.4;
      background: #fff;
    }
    .page {
      max-width: 980px;
      margin: 0 auto;
      padding: 24px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 2px solid var(--line);
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .logo-wrap img {
      height: 72px;
      width: auto;
      object-fit: contain;
      display: block;
    }
    .title h1 {
      margin: 0;
      font-size: 28px;
      letter-spacing: 0.01em;
      color: var(--brand);
      line-height: 1.1;
    }
    .title .meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }
    .section {
      margin-top: 12px;
      border: 1px solid var(--line);
      break-inside: avoid;
    }
    .section h2 {
      margin: 0;
      padding: 8px 10px;
      background: var(--accent);
      color: #fff;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .kv {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .kv td {
      border-top: 1px solid var(--line);
      padding: 7px 9px;
      vertical-align: top;
    }
    .kv td:first-child {
      width: 200px;
      font-weight: 700;
      background: #f9fafb;
    }
    .copy {
      padding: 10px;
      font-size: 13px;
    }
    .copy p {
      margin: 0 0 8px 0;
    }
    .options {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.8px;
    }
    .options th, .options td {
      border: 1px solid var(--line);
      padding: 7px 8px;
      vertical-align: top;
    }
    .options th {
      text-align: left;
      background: var(--panel);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .options td.option {
      width: 42px;
      text-align: center;
      font-weight: 800;
    }
    .options td.right {
      text-align: right;
      white-space: nowrap;
    }
    .features {
      margin-top: 4px;
      color: var(--muted);
      font-size: 11.5px;
    }
    ul {
      margin: 8px 0 8px 18px;
      padding: 0 0 0 4px;
    }
    li {
      margin: 3px 0;
    }
    .footer {
      margin-top: 14px;
      border-top: 1px solid var(--line);
      padding-top: 8px;
      color: var(--muted);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    @media print {
      .page { max-width: none; padding: 12px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="header">
      <div class="logo-wrap">
        <img src="${escapeHtml(brand.logoPath)}" alt="${escapeHtml(brand.companyName)} logo" />
      </div>
      <div class="title">
        <h1>${escapeHtml(brand.proposalTitle)}</h1>
        <div class="meta">${escapeHtml(brand.companyName)} • ${escapeHtml(brand.license)} • ${escapeHtml(brand.phone)}</div>
      </div>
    </header>

    <section class="section">
      <h2>Customer Information</h2>
      <table class="kv">
        <tr><td>Client</td><td>${customerName}</td></tr>
        <tr><td>Property</td><td>${propertyAddress}</td></tr>
        <tr><td>Phone</td><td>${phone}</td></tr>
        <tr><td>Email</td><td>${email}</td></tr>
      </table>
    </section>

    <section class="section">
      <h2>Estimate Details</h2>
      <table class="kv">
        <tr><td>Date</td><td>${issueDate}</td></tr>
        <tr><td>Estimate Type</td><td>${estimateType}</td></tr>
        <tr><td>Pricing Mode</td><td>${pricingMode}</td></tr>
        <tr><td>Prepared By</td><td>${preparedBy}</td></tr>
        <tr><td>Scope</td><td>${scopeSummary}</td></tr>
        ${includeProposalId ? `<tr><td>Proposal ID</td><td>${proposalId}</td></tr>` : ''}
        <tr><td>Estimate Valid Through</td><td>${expiresDate}</td></tr>
      </table>
    </section>
    ${newBuildSection}

    <section class="section">
      <h2>Project Scope</h2>
      <div class="copy">
        <p>${scopeSummary}</p>
        <p><strong>Manufacturer's Warranty:</strong> ${escapeHtml(brand.warrantyBlurb)}</p>
      </div>
    </section>

    <section class="section">
      <h2>System Options</h2>
      <table class="options">
        <thead>
          <tr>
            <th>Option</th>
            <th>Description</th>
            <th>Model / Code</th>
            <th>Type</th>
            <th style="text-align:right">Price</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${optionsRows}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Installation Details</h2>
      <div class="copy">
        <p><strong>What's Included:</strong></p>
        <ul>${listItemsToHtml(brand.includedItems)}</ul>
        <p><strong>What's Not Included:</strong></p>
        <ul>${listItemsToHtml(brand.excludedItems)}</ul>
      </div>
    </section>

    <section class="section">
      <h2>Next Steps</h2>
      <div class="copy">
        <p>${escapeHtml(brand.nextSteps)}</p>
        <p>${escapeHtml(brand.legalDisclaimer)}</p>
      </div>
    </section>

    <footer class="footer">
      <div>${escapeHtml(brand.companyName)} | ${escapeHtml(brand.license)} | ${escapeHtml(brand.phone)}</div>
      <div>Estimate ${escapeHtml(estimate?.estimate_id || '')}</div>
    </footer>
  </div>
</body>
</html>`;
}
