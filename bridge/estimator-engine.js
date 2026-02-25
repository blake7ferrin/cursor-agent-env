import { randomUUID } from 'node:crypto';
import {
  EstimatorValidationError,
  getDefaultEstimatorConfig,
  normalizeRate,
} from './estimator-domain.js';

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
  const lines = estimate.line_items
    .map((line) => {
      const features = line.features?.length ? `<div>${escapeHtml(line.features.join(' | '))}</div>` : '';
      return `
        <tr>
          <td>${escapeHtml(line.code)}</td>
          <td>
            <strong>${escapeHtml(line.name)}</strong>
            ${features}
          </td>
          <td>${line.quantity}</td>
          <td style="text-align:right">${formatMoney(line.costs.targetSellPrice, estimate.currency)}</td>
        </tr>
      `;
    })
    .join('\n');

  const customerName = escapeHtml(estimate.customer?.name || 'Customer');
  const projectSummary = escapeHtml(estimate.project?.summary || 'HVAC service estimate');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Estimate ${escapeHtml(estimate.estimate_id)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
    h1, h2, h3 { margin-bottom: 8px; }
    .muted { color: #666; font-size: 12px; }
    .totals { margin-top: 20px; width: 320px; margin-left: auto; border-collapse: collapse; }
    .totals td { padding: 6px 8px; border-top: 1px solid #ddd; }
    .line-items { width: 100%; border-collapse: collapse; margin-top: 16px; }
    .line-items th, .line-items td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }
    .line-items th { background: #f8f8f8; text-align: left; }
  </style>
</head>
<body>
  <h1>HVAC Estimate</h1>
  <div class="muted">Estimate ID: ${escapeHtml(estimate.estimate_id)}</div>
  <div class="muted">Generated: ${escapeHtml(estimate.generated_at)}</div>
  <div class="muted">Expires: ${escapeHtml(estimate.expires_at)}</div>
  <h3>Customer</h3>
  <div>${customerName}</div>
  <h3>Project</h3>
  <div>${projectSummary}</div>
  <table class="line-items">
    <thead>
      <tr>
        <th>Code</th>
        <th>Description</th>
        <th>Qty</th>
        <th style="text-align:right">Target Sell</th>
      </tr>
    </thead>
    <tbody>
      ${lines}
    </tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td style="text-align:right">${formatMoney(estimate.totals.subtotalAfterDiscount, estimate.currency)}</td></tr>
    <tr><td>Tax</td><td style="text-align:right">${formatMoney(estimate.totals.taxTotal, estimate.currency)}</td></tr>
    <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${formatMoney(estimate.totals.grandTotal, estimate.currency)}</strong></td></tr>
  </table>
  <p><strong>Payment terms:</strong> ${escapeHtml(estimate.assumptions.paymentTerms)}</p>
</body>
</html>`;
}
