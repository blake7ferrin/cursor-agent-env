import { buildEstimate } from './estimator-engine.js';

const DEFAULT_PRIMARY_BRANDS = ['AC Pro', 'Day & Night'];

const RISK_ADDER_MAP = Object.freeze({
  tightAttic: {
    code: 'tight_attic',
    label: 'Tight attic access',
    keywords: ['tight attic', 'attic access', 'crawl access', 'restricted attic'],
    manualItem: {
      code: 'ADDER-TIGHT-ATTIC',
      name: 'Tight attic access labor adder',
      itemType: 'labor',
      quantity: 1,
      unitCost: 0,
      laborHoursPerUnit: 3.5,
      taxable: false,
    },
  },
  craneRequired: {
    code: 'crane_required',
    label: 'Crane or lift required',
    keywords: ['crane', 'lift', 'rigging'],
    manualItem: {
      code: 'ADDER-CRANE',
      name: 'Crane / lift coordination adder',
      itemType: 'service',
      quantity: 1,
      unitCost: 0,
      laborHoursPerUnit: 4,
      taxable: false,
    },
  },
  curbAdapterRequired: {
    code: 'curb_adapter_required',
    label: 'Curb adapter required',
    keywords: ['curb adapter', 'adapter curb', 'roof curb'],
    manualItem: {
      code: 'ADDER-CURB-ADAPTER',
      name: 'Curb adapter fabrication/install adder',
      itemType: 'service',
      quantity: 1,
      unitCost: 0,
      laborHoursPerUnit: 2.5,
      taxable: false,
    },
  },
  downflowMobileHomeCoil: {
    code: 'mobile_home_downflow',
    label: 'Downflow mobile-home coil configuration',
    keywords: ['mobile home', 'downflow', 'manufactured home'],
    manualItem: {
      code: 'ADDER-MOBILE-DOWNFLOW',
      name: 'Downflow mobile-home adaptation adder',
      itemType: 'labor',
      quantity: 1,
      unitCost: 0,
      laborHoursPerUnit: 2,
      taxable: false,
    },
  },
  lineSetReplacementRequired: {
    code: 'line_set_replacement',
    label: 'Line set replacement required',
    keywords: ['line set', 'lineset', 'line-set'],
    manualItem: {
      code: 'ADDER-LINESET',
      name: 'Line-set replacement labor adder',
      itemType: 'labor',
      quantity: 1,
      unitCost: 0,
      laborHoursPerUnit: 2.5,
      taxable: false,
    },
  },
  electricalUpgrade: {
    code: 'electrical_upgrade',
    label: 'Electrical upgrade likely',
    keywords: ['electrical', 'breaker', 'disconnect', 'wire', 'conductor'],
    manualItem: {
      code: 'ADDER-ELECTRICAL',
      name: 'Electrical scope review adder',
      itemType: 'service',
      quantity: 1,
      unitCost: 0,
      laborHoursPerUnit: 1.5,
      taxable: false,
    },
  },
});

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return `${value}`.trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  const normalized = normalizeLower(value);
  if (!normalized) return false;
  return ['true', 'yes', '1', 'y'].includes(normalized);
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  const single = normalizeText(value);
  return single ? [single] : [];
}

function normalizePhase(value) {
  const normalized = normalizeLower(value);
  if (!normalized) return '';
  if (normalized === '3' || normalized.includes('three')) return 'three';
  if (normalized === '1' || normalized.includes('single')) return 'single';
  return normalized;
}

function normalizeSystemType(value) {
  const normalized = normalizeLower(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.includes('mini split') || normalized.includes('ductless')) return 'mini_split';
  if (normalized.includes('package')) return 'package_unit';
  if (normalized.includes('heat pump') || normalized === 'hp') return 'split_heat_pump';
  if (normalized.includes('gas') && normalized.includes('split')) return 'split_ac_furnace';
  if (normalized.includes('air conditioner') || normalized.includes('split ac') || normalized === 'ac') return 'split_ac';
  return normalized.replace(/\s+/g, '_');
}

function findAttribute(attributes, keys) {
  if (!attributes || typeof attributes !== 'object') return '';
  for (const key of keys) {
    if (attributes[key] !== undefined) return attributes[key];
  }
  const byLowerKey = Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const value = byLowerKey[key.toLowerCase()];
    if (value !== undefined) return value;
  }
  return '';
}

function normalizeForMatch(value) {
  return normalizeText(value).toLowerCase();
}

function parseTonnageFromText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(ton|t)\b/i);
  if (!match) return null;
  return Number(match[1]);
}

function summarizeCatalogOption(item) {
  const attrs = item.attributes || {};
  const tonnage = normalizeNumber(findAttribute(attrs, ['tonnage', 'capacity_tons'])) ?? parseTonnageFromText(item.name);
  const seer2 = normalizeNumber(findAttribute(attrs, ['seer2', 'seer_2', 'seer_rating', 'seer']));
  const brand =
    normalizeText(findAttribute(attrs, ['brand', 'manufacturer', 'oemBrand'])) ||
    (normalizeForMatch(item.name).includes('ac pro')
      ? 'AC Pro'
      : normalizeForMatch(item.name).includes('day & night')
        ? 'Day & Night'
        : '');
  const systemTypeRaw =
    normalizeText(findAttribute(attrs, ['systemType', 'system_type', 'system'])) ||
    (normalizeForMatch(item.name).includes('heat pump')
      ? 'Heat Pump'
      : normalizeForMatch(item.name).includes('mini split') || normalizeForMatch(item.name).includes('mini-split')
        ? 'Mini Split'
        : normalizeForMatch(item.name).includes('package')
          ? 'Package Unit'
          : normalizeForMatch(item.name).includes('air conditioner')
            ? 'Air Conditioner'
            : '');
  const systemType = systemTypeRaw;
  const systemTypeCanonical = normalizeSystemType(systemTypeRaw);
  const phase = normalizePhase(findAttribute(attrs, ['phase', 'power_phase']));
  const vendorContact = normalizeText(
    findAttribute(attrs, ['vendorContact', 'vendor_contact', 'supplier_contact', 'distributor_contact']),
  );
  const vendorQuoteRequired = normalizeBoolean(
    findAttribute(attrs, ['vendorQuoteRequired', 'vendor_quote_required', 'quote_required']),
  );

  return {
    sku: item.sku,
    name: item.name,
    itemType: item.itemType,
    brand,
    tonnage,
    seer2,
    systemType,
    systemTypeCanonical,
    phase,
    vendorContact,
    vendorQuoteRequired,
    unitCost: item.unitCost,
    defaultLaborHours: item.defaultLaborHours,
    features: item.features || [],
    notes: item.notes || '',
  };
}

function getRiskFlags(intake) {
  const riskFlags = [];
  const conditions = intake.installConditions || {};

  if (normalizeLower(intake.propertyType) === 'commercial') {
    riskFlags.push({ code: 'commercial_job', label: 'Commercial job scope' });
  }
  if (normalizePhase(intake.phase) === 'three') {
    riskFlags.push({ code: 'three_phase_power', label: '3-phase equipment / power' });
  }

  for (const [conditionKey, config] of Object.entries(RISK_ADDER_MAP)) {
    if (normalizeBoolean(conditions[conditionKey])) {
      riskFlags.push({ code: config.code, label: config.label });
    }
  }

  return riskFlags;
}

function toManualItemFromCatalogAdder(item, fallbackCode) {
  return {
    code: item.sku || fallbackCode,
    name: item.name,
    itemType: item.itemType === 'equipment' ? 'service' : item.itemType,
    quantity: 1,
    unitCost: Number.isFinite(Number(item.unitCost)) ? Number(item.unitCost) : 0,
    laborHoursPerUnit: Number.isFinite(Number(item.defaultLaborHours)) ? Number(item.defaultLaborHours) : 0,
    taxable: item.taxable !== undefined ? Boolean(item.taxable) : false,
  };
}

function scoreAdderCandidate(item, keywords) {
  const attrs = item.attributes || {};
  const sourceCategory = normalizeForMatch(attrs.sourceCategory);
  const sourceSubcategory = normalizeForMatch(attrs.sourceSubcategory);
  const nameBlob = `${normalizeForMatch(item.name)} ${sourceCategory} ${sourceSubcategory}`;
  let score = 0;
  let keywordHits = 0;
  for (const keyword of keywords) {
    if (nameBlob.includes(normalizeForMatch(keyword))) {
      score += 3;
      keywordHits += 1;
    }
  }
  if (keywordHits === 0) return 0;
  if (sourceCategory.includes('adder')) score += 3;
  if (sourceCategory.includes('install')) score += 2;
  if (sourceSubcategory.includes('adder')) score += 2;
  if (item.itemType === 'labor') score += 1;
  return score;
}

function findCatalogAdderForRisk(catalog, riskConfig) {
  const keywords = riskConfig.keywords || [];
  if (!keywords.length || !Array.isArray(catalog) || !catalog.length) return null;

  let best = null;
  let bestScore = 0;
  for (const item of catalog) {
    if (!item || typeof item !== 'object') continue;
    if (item.itemType === 'equipment') continue;
    const score = scoreAdderCandidate(item, keywords);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function getComplexityAdders(intake, catalog) {
  const conditions = intake.installConditions || {};
  const adders = [];
  const resolution = [];
  for (const [conditionKey, config] of Object.entries(RISK_ADDER_MAP)) {
    if (!normalizeBoolean(conditions[conditionKey])) continue;
    const catalogAdder = findCatalogAdderForRisk(catalog, config);
    if (catalogAdder) {
      adders.push(toManualItemFromCatalogAdder(catalogAdder, config.manualItem?.code || config.code));
      resolution.push({
        risk: config.code,
        source: 'catalog',
        sku: catalogAdder.sku || '',
        name: catalogAdder.name || '',
      });
      continue;
    }
    if (config.manualItem) {
      adders.push(config.manualItem);
      resolution.push({
        risk: config.code,
        source: 'fallback',
        sku: config.manualItem.code,
        name: config.manualItem.name,
      });
    }
  }
  return { adders, resolution };
}

function buildFollowUpQuestions({ missingFields, riskFlags, lane, requestedBrands }) {
  const questions = [];
  for (const field of missingFields) {
    if (field === 'tonnage') questions.push('What tonnage should we quote (e.g. 3.0, 4.0, 5.0)?');
    if (field === 'systemType') questions.push('Is this split heat pump, split AC furnace, package unit, or mini-split?');
    if (field === 'phase') questions.push('Is this single-phase or three-phase power?');
  }

  if (riskFlags.some((flag) => flag.code === 'crane_required')) {
    questions.push('Please confirm crane size window and staging restrictions.');
  }
  if (riskFlags.some((flag) => flag.code === 'curb_adapter_required')) {
    questions.push('Please capture curb dimensions so we can confirm adapter requirements.');
  }
  if (riskFlags.some((flag) => flag.code === 'commercial_job')) {
    questions.push('For commercial scope, confirm controls sequence and final equipment availability before final pricing.');
  }

  if (lane === 'awaiting_vendor_quote' && requestedBrands.length) {
    questions.push(`Need current distributor pricing and stock check for ${requestedBrands.join(', ')}.`);
  }

  return Array.from(new Set(questions));
}

function buildVendorChecklist(requestedBrands, recommendedOptions) {
  const contacts = new Set();
  for (const option of recommendedOptions) {
    if (option.vendorContact) contacts.add(option.vendorContact);
  }
  const brandChecklist = requestedBrands.map((brand) => `Confirm ${brand} equipment availability + net cost.`);
  return {
    contacts: Array.from(contacts),
    checklist: [
      ...brandChecklist,
      'Confirm lead time and warranty registration requirements.',
      'Confirm any model substitutions currently in stock.',
    ],
  };
}

function scoreOption(option, intake, requestedBrands) {
  let score = 0;
  const requestedTonnage = normalizeNumber(intake.tonnage);
  const requestedSystemType = normalizeSystemType(intake.systemType);
  const requestedPhase = normalizePhase(intake.phase || 'single');
  const optionBrandLower = normalizeLower(option.brand);

  if (requestedBrands.length && requestedBrands.some((brand) => optionBrandLower === normalizeLower(brand))) score += 4;
  if (requestedTonnage !== null && option.tonnage !== null && Math.abs(option.tonnage - requestedTonnage) < 0.01) score += 3;
  if (requestedSystemType && option.systemTypeCanonical && option.systemTypeCanonical === requestedSystemType) score += 3;
  if (requestedPhase && option.phase && normalizePhase(option.phase) === requestedPhase) score += 2;
  if (!option.vendorQuoteRequired) score += 1;
  return score;
}

function laneFromContext({ intake, missingFields, selectedOption, recommendedOptions, requiresManualReview }) {
  if (missingFields.length) return 'needs_questions';
  if (requiresManualReview) return 'manual_review';

  const pricingKnown = intake.pricingKnown !== false;
  if (selectedOption) {
    if (!pricingKnown || selectedOption.vendorQuoteRequired) return 'awaiting_vendor_quote';
    return 'auto_ready';
  }

  if (recommendedOptions.length > 0) return 'needs_selection';
  return 'awaiting_vendor_quote';
}

function computeConfidence({ lane, missingFields, recommendedOptions, selectedOption, requiresManualReview }) {
  let score = 0.35;
  score += Math.max(0, 0.2 - missingFields.length * 0.08);
  if (recommendedOptions.length > 0) score += 0.12;
  if (selectedOption) score += 0.2;
  if (requiresManualReview) score -= 0.2;
  if (lane === 'awaiting_vendor_quote') score -= 0.12;
  if (lane === 'auto_ready') score += 0.1;
  return Math.min(0.97, Math.max(0.05, Math.round(score * 100) / 100));
}

export function buildChangeoutPlan({ profile = {}, intake = {}, customer = {}, project = {}, limit = 6 } = {}) {
  const catalog = Array.isArray(profile.catalog) ? profile.catalog : [];
  const config = profile.config && typeof profile.config === 'object' ? profile.config : {};
  const normalizedLimit = Math.max(1, Math.min(20, Number.parseInt(`${limit || 6}`, 10) || 6));

  const requestedBrands = Array.from(
    new Set(
      [
        ...normalizeArray(intake.requestedBrand),
        ...normalizeArray(intake.requestedBrands),
        ...normalizeArray(intake.alternateBrands),
      ],
    ),
  );
  const defaultBrands = requestedBrands.length
    ? requestedBrands
    : [...normalizeArray(intake.primaryBrands), ...DEFAULT_PRIMARY_BRANDS];
  const selectedSku = normalizeText(intake.selectedEquipmentSku || intake.selected_equipment_sku);

  const equipmentOptions = catalog
    .filter((item) => item.itemType === 'equipment')
    .map((item) => summarizeCatalogOption(item));

  const requestedTonnage = normalizeNumber(intake.tonnage);
  const requestedSystemType = normalizeSystemType(intake.systemType);
  const requestedPhase = normalizePhase(intake.phase || 'single');

  const recommendedOptions = equipmentOptions
    .filter((option) => {
      if (defaultBrands.length) {
        const brandMatch = defaultBrands.some((brand) => normalizeLower(brand) === normalizeLower(option.brand));
        if (!brandMatch && defaultBrands.length && option.brand) return false;
      }
      if (requestedTonnage !== null && option.tonnage !== null && Math.abs(option.tonnage - requestedTonnage) > 0.01) {
        return false;
      }
      if (requestedSystemType && option.systemTypeCanonical && option.systemTypeCanonical !== requestedSystemType) {
        return false;
      }
      if (requestedPhase && option.phase && normalizePhase(option.phase) !== requestedPhase) {
        return false;
      }
      return true;
    })
    .sort((a, b) => scoreOption(b, intake, defaultBrands) - scoreOption(a, intake, defaultBrands))
    .slice(0, normalizedLimit);

  const selectedOption =
    recommendedOptions.find((option) => option.sku === selectedSku) ||
    equipmentOptions.find((option) => option.sku === selectedSku) ||
    null;

  const missingFields = [];
  if (requestedTonnage === null) missingFields.push('tonnage');
  if (!requestedSystemType) missingFields.push('systemType');
  if (!requestedPhase) missingFields.push('phase');

  const riskFlags = getRiskFlags(intake);
  const requiresManualReview = riskFlags.some((flag) =>
    ['commercial_job', 'three_phase_power', 'crane_required', 'curb_adapter_required'].includes(flag.code),
  );
  const { adders: complexityAdders, resolution: complexityAddersResolution } = getComplexityAdders(intake, catalog);
  const lane = laneFromContext({
    intake,
    missingFields,
    selectedOption,
    recommendedOptions,
    requiresManualReview,
  });

  const followUpQuestions = buildFollowUpQuestions({
    missingFields,
    riskFlags,
    lane,
    requestedBrands: defaultBrands,
  });

  const vendorChecklist = buildVendorChecklist(defaultBrands, recommendedOptions);

  let draftEstimateRequest = null;
  let estimatePreview = null;
  if (lane === 'auto_ready' && selectedOption) {
    draftEstimateRequest = {
      selections: [{ sku: selectedOption.sku, quantity: 1 }],
      manual_items: complexityAdders,
      customer,
      project: {
        ...project,
        summary:
          normalizeText(project.summary) ||
          `${selectedOption.tonnage || requestedTonnage || ''} Ton ${selectedOption.brand || ''} ${selectedOption.systemType || ''}`.trim(),
      },
      adjustments: {
        permitFee: normalizeNumber(intake.permitFee),
        tripCharge: normalizeNumber(intake.tripCharge),
      },
    };
    estimatePreview = buildEstimate({
      config,
      catalog,
      ...draftEstimateRequest,
    });
  }

  const confidenceScore = computeConfidence({
    lane,
    missingFields,
    recommendedOptions,
    selectedOption,
    requiresManualReview,
  });

  const nextStepByLane = {
    auto_ready: 'Review estimate preview and send/export.',
    needs_selection: 'Choose one recommended equipment option and re-run plan.',
    needs_questions: 'Answer follow-up questions to complete scope before pricing.',
    awaiting_vendor_quote: 'Collect distributor pricing/stock info, then re-run plan with selected SKU.',
    manual_review: 'Route to estimator review due to complexity/commercial constraints.',
  };

  return {
    lane,
    confidence_score: confidenceScore,
    risk_flags: riskFlags,
    missing_fields: missingFields,
    follow_up_questions: followUpQuestions,
    recommended_options: recommendedOptions,
    complexity_adders: complexityAdders,
    complexity_adders_resolution: complexityAddersResolution,
    vendor_quote: vendorChecklist,
    profit_targets: {
      targetGrossMargin: config.targetGrossMargin ?? 0.4,
      minimumGrossMargin: config.minimumGrossMargin ?? 0.3,
      enforceMinimumGrossMargin:
        config.enforceMinimumGrossMargin === undefined
          ? true
          : Boolean(config.enforceMinimumGrossMargin),
    },
    draft_estimate_request: draftEstimateRequest,
    estimate_preview: estimatePreview,
    next_step: nextStepByLane[lane] || nextStepByLane.needs_questions,
  };
}
