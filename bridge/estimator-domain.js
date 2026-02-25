const DEFAULT_CONFIG = Object.freeze({
  businessName: 'HVAC Business',
  currency: 'USD',
  laborRatePerHour: 125,
  laborBurdenRate: 0,
  overheadRate: 0,
  contingencyRate: 0,
  targetGrossMargin: 0.4,
  minimumGrossMargin: 0.3,
  enforceMinimumGrossMargin: true,
  defaultTaxRate: 0.09,
  defaultPermitFee: 0,
  defaultTripCharge: 0,
  estimateExpirationDays: 30,
  paymentTerms: '50% deposit due at scheduling, balance due at completion.',
});

const ALLOWED_ITEM_TYPES = new Set(['equipment', 'part', 'service', 'labor', 'consumable']);

export class EstimatorValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'EstimatorValidationError';
    this.details = details;
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function asTrimmedString(value, fieldName, options = {}) {
  const { maxLength = 500, allowEmpty = false, defaultValue = '' } = options;
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'string') {
    throw new EstimatorValidationError(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) {
    throw new EstimatorValidationError(`${fieldName} cannot be empty`);
  }
  return trimmed.slice(0, maxLength);
}

function asNonNegativeNumber(value, fieldName, options = {}) {
  const { defaultValue = 0 } = options;
  if (value === undefined || value === null || value === '') return defaultValue;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new EstimatorValidationError(`${fieldName} must be a non-negative number`);
  }
  return numeric;
}

function asPositiveNumber(value, fieldName, options = {}) {
  const { defaultValue = 1 } = options;
  if (value === undefined || value === null || value === '') return defaultValue;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new EstimatorValidationError(`${fieldName} must be greater than zero`);
  }
  return numeric;
}

function normalizeAttributes(attributes) {
  if (attributes === undefined || attributes === null) return {};
  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new EstimatorValidationError('catalog item attributes must be an object');
  }

  const normalized = {};
  for (const [rawKey, value] of Object.entries(attributes)) {
    const key = `${rawKey}`.trim();
    if (!key) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) normalized[key] = trimmed.slice(0, 200);
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      normalized[key] = value;
    }
  }
  return normalized;
}

export function normalizeRate(value, fieldName, options = {}) {
  const { defaultValue = 0, max = 0.95 } = options;
  if (value === undefined || value === null || value === '') return defaultValue;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new EstimatorValidationError(`${fieldName} must be a non-negative number`);
  }
  const normalized = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  if (normalized > max) {
    throw new EstimatorValidationError(`${fieldName} must be <= ${max}`);
  }
  return normalized;
}

export function normalizeEstimatorConfig(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const base = options.base && typeof options.base === 'object' ? options.base : DEFAULT_CONFIG;

  const next = { ...base };
  if (hasOwn(source, 'businessName')) {
    next.businessName = asTrimmedString(source.businessName, 'businessName', {
      maxLength: 200,
      defaultValue: base.businessName,
      allowEmpty: false,
    });
  }
  if (hasOwn(source, 'currency')) {
    const currency = asTrimmedString(source.currency, 'currency', {
      maxLength: 3,
      defaultValue: base.currency,
      allowEmpty: false,
    });
    next.currency = currency.toUpperCase();
  }
  if (hasOwn(source, 'laborRatePerHour')) {
    next.laborRatePerHour = asNonNegativeNumber(source.laborRatePerHour, 'laborRatePerHour');
  }
  if (hasOwn(source, 'laborBurdenRate')) {
    next.laborBurdenRate = normalizeRate(source.laborBurdenRate, 'laborBurdenRate', { max: 2 });
  }
  if (hasOwn(source, 'overheadRate')) {
    next.overheadRate = normalizeRate(source.overheadRate, 'overheadRate', { max: 2 });
  }
  if (hasOwn(source, 'contingencyRate')) {
    next.contingencyRate = normalizeRate(source.contingencyRate, 'contingencyRate', { max: 1 });
  }
  if (hasOwn(source, 'targetGrossMargin')) {
    next.targetGrossMargin = normalizeRate(source.targetGrossMargin, 'targetGrossMargin', { max: 0.95 });
  }
  if (hasOwn(source, 'minimumGrossMargin')) {
    next.minimumGrossMargin = normalizeRate(source.minimumGrossMargin, 'minimumGrossMargin', { max: 0.95 });
  }
  if (hasOwn(source, 'enforceMinimumGrossMargin')) {
    next.enforceMinimumGrossMargin = Boolean(source.enforceMinimumGrossMargin);
  }
  if (hasOwn(source, 'defaultTaxRate')) {
    next.defaultTaxRate = normalizeRate(source.defaultTaxRate, 'defaultTaxRate', { max: 1 });
  }
  if (hasOwn(source, 'defaultPermitFee')) {
    next.defaultPermitFee = asNonNegativeNumber(source.defaultPermitFee, 'defaultPermitFee');
  }
  if (hasOwn(source, 'defaultTripCharge')) {
    next.defaultTripCharge = asNonNegativeNumber(source.defaultTripCharge, 'defaultTripCharge');
  }
  if (hasOwn(source, 'estimateExpirationDays')) {
    const days = asPositiveNumber(source.estimateExpirationDays, 'estimateExpirationDays');
    next.estimateExpirationDays = Math.floor(days);
  }
  if (hasOwn(source, 'paymentTerms')) {
    next.paymentTerms = asTrimmedString(source.paymentTerms, 'paymentTerms', {
      maxLength: 500,
      defaultValue: base.paymentTerms,
      allowEmpty: false,
    });
  }

  return next;
}

export function normalizeCatalogItem(item = {}) {
  if (!item || typeof item !== 'object') {
    throw new EstimatorValidationError('catalog item must be an object');
  }

  const sku = asTrimmedString(item.sku, 'catalog item sku', { maxLength: 120 });
  const name = asTrimmedString(item.name, 'catalog item name', { maxLength: 240 });
  const itemType = asTrimmedString(item.itemType ?? 'part', 'catalog item itemType', {
    maxLength: 40,
  }).toLowerCase();

  if (!ALLOWED_ITEM_TYPES.has(itemType)) {
    throw new EstimatorValidationError(
      `catalog item itemType must be one of: ${Array.from(ALLOWED_ITEM_TYPES).join(', ')}`,
    );
  }

  const unitCost = asNonNegativeNumber(item.unitCost, 'catalog item unitCost');
  const defaultLaborHours = asNonNegativeNumber(item.defaultLaborHours, 'catalog item defaultLaborHours');
  const taxable = item.taxable === undefined ? true : Boolean(item.taxable);
  const features = Array.isArray(item.features)
    ? item.features
        .filter((feature) => typeof feature === 'string' && feature.trim())
        .map((feature) => feature.trim().slice(0, 200))
    : [];
  const notes = item.notes
    ? asTrimmedString(item.notes, 'catalog item notes', { maxLength: 500, allowEmpty: true })
    : '';
  const attributes = normalizeAttributes(item.attributes);

  return {
    sku,
    name,
    itemType,
    unitCost,
    defaultLaborHours,
    taxable,
    features,
    notes,
    attributes,
  };
}

export function getDefaultEstimatorConfig() {
  return { ...DEFAULT_CONFIG };
}
