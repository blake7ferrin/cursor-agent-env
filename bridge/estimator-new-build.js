import { EstimatorValidationError } from './estimator-domain.js';

const ESTIMATE_TYPE_NEW_BUILD = 'new_build';
const PRICING_MODE_STANDARD = 'standard';
const PRICING_MODES = new Set(['budget', 'standard', 'detailed']);

const DEFAULT_NEW_BUILD_PRICING_TABLES = Object.freeze({
  equipment: {
    baseCostPerTon: 1850,
    efficiencyTierMultipliers: {
      base: 1,
      standard: 1.08,
      high: 1.18,
      premium: 1.28,
    },
    equipmentTypeMultipliers: {
      split: 1,
      package: 0.96,
      heat_pump: 1.1,
      gas_split: 1.06,
      mini_split: 0.94,
      default: 1,
    },
    heatTypeMultipliers: {
      gas: 1.05,
      electric: 1,
      heat_pump: 1.08,
      default: 1,
    },
    installHoursPerTon: {
      rough_in_only: 3.2,
      rough_in_plus_trim: 4.4,
      full_install: 5.2,
    },
    locationMultipliers: {
      attic: 1.12,
      closet: 1.03,
      garage: 1,
      platform: 1.08,
      rooftop: 1.18,
      default: 1,
    },
  },
  accessories: {
    thermostat: {
      basic: 75,
      standard: 140,
      smart: 285,
      communicating: 420,
    },
    pad: 115,
    disconnect: 58,
    whip: 42,
    filterBase: 95,
    zoningPerZone: 360,
    lineSetPerFoot: 13.5,
    condensateDrainPerFoot: 3.8,
    condensatePump: 145,
    floatSwitch: 38,
    secondaryDrainPan: 88,
  },
  airDistribution: {
    supplyRegister: 78,
    returnGrille: 88,
    returnBox: 92,
    supplyBoot: 56,
    returnBoot: 64,
    flexRun: 52,
    flexDuctPerFoot: 5.8,
    hardDuctPerFoot: 21,
    trunk14PerFoot: 18,
    trunk12PerFoot: 16,
    trunk10PerFoot: 14,
    trunk8PerFoot: 12,
    transition: 72,
    balancingDamper: 34,
    premiumGrilleAdder: 260,
  },
  ventilation: {
    bathFan: 220,
    dryerVent: 155,
    rangeHoodVent: 185,
    freshAirKit: 310,
    exhaustRoofCap: 95,
    exhaustWallCap: 78,
  },
  adders: {
    permit: 420,
    crane: 1200,
    highCeiling: 450,
    longLineSet: 360,
    difficultAttic: 525,
    twoStory: 580,
    startupCommissioning: 520,
  },
  multipliers: {
    stories: {
      1: 1,
      2: 1.08,
      '3+': 1.16,
    },
    atticDifficulty: {
      easy: 0.97,
      standard: 1,
      difficult: 1.12,
    },
    ductType: {
      flex: 1,
      hard_duct: 1.1,
      mixed: 1.05,
    },
    pricingMode: {
      budget: 0.94,
      standard: 1,
      detailed: 1.05,
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

function toNonNegativeNumber(value, fieldPath, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new EstimatorValidationError(`${fieldPath} must be a non-negative number`);
  }
  return numeric;
}

function toBoolean(value, defaultValue = false) {
  if (value === true || value === false) return value;
  const normalized = normalizeLower(value);
  if (!normalized) return defaultValue;
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return defaultValue;
}

function canonicalStories(value) {
  if (value === '3+' || value === 3 || value === '3') return '3+';
  if (value === 2 || value === '2') return 2;
  return 1;
}

function canonicalPricingMode(value) {
  const normalized = normalizeLower(value).replace('-', '_');
  if (PRICING_MODES.has(normalized)) return normalized;
  return PRICING_MODE_STANDARD;
}

function canonicalEstimateType(value) {
  return normalizeLower(value) === ESTIMATE_TYPE_NEW_BUILD ? ESTIMATE_TYPE_NEW_BUILD : 'changeout';
}

function canonicalEquipmentType(value) {
  const normalized = normalizeLower(value).replace(/[\s-]+/g, '_');
  if (normalized.includes('heat') && normalized.includes('pump')) return 'heat_pump';
  if (normalized.includes('gas') && normalized.includes('split')) return 'gas_split';
  if (normalized.includes('mini') && normalized.includes('split')) return 'mini_split';
  if (normalized.includes('package')) return 'package';
  if (normalized.includes('split')) return 'split';
  return normalized || 'split';
}

function canonicalHeatType(value) {
  const normalized = normalizeLower(value).replace(/[\s-]+/g, '_');
  if (normalized.includes('heat_pump') || normalized === 'hp') return 'heat_pump';
  if (normalized.includes('gas')) return 'gas';
  if (normalized.includes('electric')) return 'electric';
  return 'electric';
}

function canonicalInstallType(value) {
  const normalized = normalizeLower(value).replace(/[\s-]+/g, '_');
  if (normalized === 'rough_in_only') return 'rough_in_only';
  if (normalized === 'rough_in_plus_trim') return 'rough_in_plus_trim';
  return 'full_install';
}

function canonicalSystemLocation(value) {
  const normalized = normalizeLower(value).replace(/[\s-]+/g, '_');
  if (['attic', 'closet', 'garage', 'platform', 'rooftop'].includes(normalized)) return normalized;
  return 'garage';
}

function canonicalAtticDifficulty(value) {
  const normalized = normalizeLower(value);
  if (normalized === 'easy') return 'easy';
  if (normalized === 'difficult') return 'difficult';
  return 'standard';
}

function canonicalDuctType(value) {
  const normalized = normalizeLower(value).replace(/[\s-]+/g, '_');
  if (normalized === 'hard_duct') return 'hard_duct';
  if (normalized === 'mixed') return 'mixed';
  return 'flex';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergePricingTables(base, patch, pathPrefix = 'new_build.pricingTableOverrides') {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(base);
  const output = clone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(output, key)) continue;
    const baseValue = output[key];
    const fieldPath = `${pathPrefix}.${key}`;
    if (typeof baseValue === 'number') {
      output[key] = toNonNegativeNumber(value, fieldPath, baseValue);
      continue;
    }
    if (typeof baseValue === 'object' && baseValue && !Array.isArray(baseValue)) {
      output[key] = mergePricingTables(baseValue, value, fieldPath);
    }
  }
  return output;
}

function resolveEquipmentTierMultiplier(tierText, table) {
  const tier = normalizeLower(tierText);
  if (!tier) return table.standard;
  if (tier.includes('premium') || tier.includes('20') || tier.includes('ultra')) return table.premium;
  if (tier.includes('high') || tier.includes('18') || tier.includes('19')) return table.high;
  if (tier.includes('base') || tier.includes('builder') || tier.includes('14') || tier.includes('15')) return table.base;
  return table.standard;
}

function inferCatalogEquipmentMatch(system, catalog) {
  const sku = normalizeText(system.equipmentSku);
  if (sku) {
    const direct = catalog.find((item) => item.sku === sku && item.itemType === 'equipment');
    if (direct) return direct;
  }
  const tonnage = toNonNegativeNumber(system.tonnage, 'new_build.systems[].tonnage', 0);
  const equipmentType = canonicalEquipmentType(system.equipmentType);
  const heatType = canonicalHeatType(system.heatType);
  const candidates = (Array.isArray(catalog) ? catalog : []).filter((item) => item?.itemType === 'equipment');
  if (!candidates.length) return null;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of candidates) {
    const attrType = canonicalEquipmentType(item.attributes?.systemType || item.attributes?.system_type || item.name);
    const attrHeat = canonicalHeatType(item.attributes?.heatType || item.attributes?.heat_type || item.name);
    const attrTonnage = Number(item.attributes?.tonnage);
    const tonnageDelta = Number.isFinite(attrTonnage) ? Math.abs(attrTonnage - tonnage) : 0.75;
    const typePenalty = attrType === equipmentType ? 0 : 0.8;
    const heatPenalty = attrHeat === heatType ? 0 : 0.4;
    const score = tonnageDelta + typePenalty + heatPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

function createManualLine({
  code,
  name,
  itemType = 'service',
  quantity = 1,
  unitCost = 0,
  laborHoursPerUnit = 0,
  taxable = true,
  notes = '',
}) {
  return {
    code,
    name,
    itemType,
    quantity,
    unitCost,
    laborHoursPerUnit,
    taxable,
    notes,
  };
}

function sectionRawCost(lines, laborRatePerHour) {
  return lines.reduce((sum, line) => {
    const quantity = Number(line.quantity || 0);
    const unitCost = Number(line.unitCost || 0);
    const laborHours = Number(line.laborHoursPerUnit || 0);
    return sum + unitCost * quantity + laborHours * quantity * laborRatePerHour;
  }, 0);
}

function collectModeValidationMissingFields(scope) {
  const missing = [];
  const mode = scope.pricingMode;
  if (!scope.systems.length) {
    missing.push('new_build.systems');
    return missing;
  }
  scope.systems.forEach((system, index) => {
    if (!system.equipmentType) missing.push(`new_build.systems[${index}].equipmentType`);
    if (!Number.isFinite(system.tonnage) || system.tonnage <= 0) missing.push(`new_build.systems[${index}].tonnage`);
    if (mode === 'standard' || mode === 'detailed') {
      if (!Number.isFinite(system.lineSetLength)) missing.push(`new_build.systems[${index}].lineSetLength`);
      if (!Number.isFinite(system.condensateDrainLength)) missing.push(`new_build.systems[${index}].condensateDrainLength`);
    }
    if (mode === 'detailed' && !Number.isFinite(system.zoneCount)) {
      missing.push(`new_build.systems[${index}].zoneCount`);
    }
  });

  if (!Number.isFinite(scope.airDistribution.supplyRegisterCount)) {
    missing.push('new_build.airDistribution.supplyRegisterCount');
  }
  if (!Number.isFinite(scope.airDistribution.returnGrilleCount)) {
    missing.push('new_build.airDistribution.returnGrilleCount');
  }
  if (mode === 'standard' || mode === 'detailed') {
    if (!Number.isFinite(scope.airDistribution.returnBoxCount)) missing.push('new_build.airDistribution.returnBoxCount');
    if (!Number.isFinite(scope.airDistribution.supplyBootCount)) missing.push('new_build.airDistribution.supplyBootCount');
    if (!Number.isFinite(scope.ventilation.bathFanCount)) missing.push('new_build.ventilation.bathFanCount');
  }
  if (mode === 'detailed') {
    const hasDetailedDuctLength =
      Number(scope.airDistribution.hardDuctLinearFeet || 0) > 0 ||
      Number(scope.airDistribution.trunkLineLinearFeet14 || 0) > 0 ||
      Number(scope.airDistribution.trunkLineLinearFeet12 || 0) > 0 ||
      Number(scope.airDistribution.trunkLineLinearFeet10 || 0) > 0 ||
      Number(scope.airDistribution.trunkLineLinearFeet8 || 0) > 0;
    if (!hasDetailedDuctLength) missing.push('new_build.airDistribution.(hardDuctLinearFeet|trunkLineLinearFeet*)');
    if (!Number.isFinite(scope.airDistribution.ductTransitionsCount)) {
      missing.push('new_build.airDistribution.ductTransitionsCount');
    }
    if (!Number.isFinite(scope.airDistribution.balancingDamperCount)) {
      missing.push('new_build.airDistribution.balancingDamperCount');
    }
  }
  return missing;
}

function normalizeNewBuildScope(body = {}) {
  const nested = body?.new_build && typeof body.new_build === 'object' ? body.new_build : {};
  const pricingMode = canonicalPricingMode(body.pricing_mode ?? nested.pricing_mode);
  const pricingTables = mergePricingTables(DEFAULT_NEW_BUILD_PRICING_TABLES, nested.pricingTableOverrides);
  const systemsRaw = Array.isArray(nested.systems) ? nested.systems : [];
  const systems = systemsRaw.map((system, index) => {
    if (!system || typeof system !== 'object') {
      throw new EstimatorValidationError(`new_build.systems[${index}] must be an object`);
    }
    return {
      systemId: normalizeText(system.systemId) || `SYS-${index + 1}`,
      equipmentSku: normalizeText(system.equipmentSku),
      equipmentType: canonicalEquipmentType(system.equipmentType),
      tonnage: toNonNegativeNumber(system.tonnage, `new_build.systems[${index}].tonnage`, 0),
      efficiencyTier: normalizeText(system.efficiencyTier) || 'standard',
      heatType: canonicalHeatType(system.heatType),
      systemLocation: canonicalSystemLocation(system.systemLocation),
      lineSetLength: system.lineSetLength === undefined ? undefined : toNonNegativeNumber(system.lineSetLength, `new_build.systems[${index}].lineSetLength`, 0),
      condensateDrainLength:
        system.condensateDrainLength === undefined
          ? undefined
          : toNonNegativeNumber(system.condensateDrainLength, `new_build.systems[${index}].condensateDrainLength`, 0),
      returnCount: toNonNegativeNumber(system.returnCount, `new_build.systems[${index}].returnCount`, 1),
      filterBaseIncluded: toBoolean(system.filterBaseIncluded, false),
      thermostatType: normalizeLower(system.thermostatType) || 'standard',
      zoneCount: system.zoneCount === undefined ? undefined : toNonNegativeNumber(system.zoneCount, `new_build.systems[${index}].zoneCount`, 0),
      laborDifficultyModifier: toNonNegativeNumber(system.laborDifficultyModifier, `new_build.systems[${index}].laborDifficultyModifier`, 1) || 1,
    };
  });

  const air = nested.airDistribution && typeof nested.airDistribution === 'object' ? nested.airDistribution : {};
  const ventilation = nested.ventilation && typeof nested.ventilation === 'object' ? nested.ventilation : {};
  const adders = nested.adders && typeof nested.adders === 'object' ? nested.adders : {};
  const manualOverrides = nested.manualOverrides && typeof nested.manualOverrides === 'object' ? nested.manualOverrides : {};

  const scope = {
    estimateType: canonicalEstimateType(body.estimateType ?? nested.estimateType),
    pricingMode,
    pricingTables,
    projectName: normalizeText(nested.projectName || body.projectName || body.project?.summary),
    builderName: normalizeText(nested.builderName),
    address: normalizeText(nested.address || body.project?.address || body.customer?.address),
    squareFootage: toNonNegativeNumber(nested.squareFootage, 'new_build.squareFootage', 0),
    stories: canonicalStories(nested.stories ?? adders.stories),
    atticDifficulty: canonicalAtticDifficulty(nested.atticDifficulty ?? adders.atticDifficulty),
    installType: canonicalInstallType(nested.installType),
    ductType: canonicalDuctType(nested.ductType),
    zoning: toBoolean(nested.zoning, false),
    permitRequired: toBoolean(nested.permitRequired ?? adders.permitRequired, false),
    craneRequired: toBoolean(nested.craneRequired ?? adders.craneRequired, false),
    systems,
    airDistribution: {
      supplyRegisterCount: air.supplyRegisterCount === undefined ? undefined : toNonNegativeNumber(air.supplyRegisterCount, 'new_build.airDistribution.supplyRegisterCount', 0),
      returnGrilleCount: air.returnGrilleCount === undefined ? undefined : toNonNegativeNumber(air.returnGrilleCount, 'new_build.airDistribution.returnGrilleCount', 0),
      returnBoxCount: air.returnBoxCount === undefined ? undefined : toNonNegativeNumber(air.returnBoxCount, 'new_build.airDistribution.returnBoxCount', 0),
      supplyBootCount: air.supplyBootCount === undefined ? undefined : toNonNegativeNumber(air.supplyBootCount, 'new_build.airDistribution.supplyBootCount', 0),
      returnBootCount: air.returnBootCount === undefined ? undefined : toNonNegativeNumber(air.returnBootCount, 'new_build.airDistribution.returnBootCount', 0),
      flexRunCount: toNonNegativeNumber(air.flexRunCount, 'new_build.airDistribution.flexRunCount', 0),
      flexRunTotalLength: toNonNegativeNumber(air.flexRunTotalLength, 'new_build.airDistribution.flexRunTotalLength', 0),
      hardDuctLinearFeet: toNonNegativeNumber(air.hardDuctLinearFeet, 'new_build.airDistribution.hardDuctLinearFeet', 0),
      trunkLineLinearFeet14: toNonNegativeNumber(air.trunkLineLinearFeet14, 'new_build.airDistribution.trunkLineLinearFeet14', 0),
      trunkLineLinearFeet12: toNonNegativeNumber(air.trunkLineLinearFeet12, 'new_build.airDistribution.trunkLineLinearFeet12', 0),
      trunkLineLinearFeet10: toNonNegativeNumber(air.trunkLineLinearFeet10, 'new_build.airDistribution.trunkLineLinearFeet10', 0),
      trunkLineLinearFeet8: toNonNegativeNumber(air.trunkLineLinearFeet8, 'new_build.airDistribution.trunkLineLinearFeet8', 0),
      ductTransitionsCount: air.ductTransitionsCount === undefined ? undefined : toNonNegativeNumber(air.ductTransitionsCount, 'new_build.airDistribution.ductTransitionsCount', 0),
      balancingDamperCount: air.balancingDamperCount === undefined ? undefined : toNonNegativeNumber(air.balancingDamperCount, 'new_build.airDistribution.balancingDamperCount', 0),
    },
    ventilation: {
      bathFanCount: ventilation.bathFanCount === undefined ? undefined : toNonNegativeNumber(ventilation.bathFanCount, 'new_build.ventilation.bathFanCount', 0),
      dryerVentCount: toNonNegativeNumber(ventilation.dryerVentCount, 'new_build.ventilation.dryerVentCount', 0),
      rangeHoodVentCount: toNonNegativeNumber(ventilation.rangeHoodVentCount, 'new_build.ventilation.rangeHoodVentCount', 0),
      freshAirKitCount: toNonNegativeNumber(ventilation.freshAirKitCount, 'new_build.ventilation.freshAirKitCount', 0),
      exhaustRoofCapCount: toNonNegativeNumber(ventilation.exhaustRoofCapCount, 'new_build.ventilation.exhaustRoofCapCount', 0),
      exhaustWallCapCount: toNonNegativeNumber(ventilation.exhaustWallCapCount, 'new_build.ventilation.exhaustWallCapCount', 0),
    },
    adders: {
      condensatePumpCount: toNonNegativeNumber(adders.condensatePumpCount, 'new_build.adders.condensatePumpCount', 0),
      floatSwitchCount: toNonNegativeNumber(adders.floatSwitchCount, 'new_build.adders.floatSwitchCount', 0),
      secondaryDrainPanCount: toNonNegativeNumber(adders.secondaryDrainPanCount, 'new_build.adders.secondaryDrainPanCount', 0),
      disconnectCount: toNonNegativeNumber(adders.disconnectCount, 'new_build.adders.disconnectCount', systems.length || 0),
      whipCount: toNonNegativeNumber(adders.whipCount, 'new_build.adders.whipCount', systems.length || 0),
      padCount: toNonNegativeNumber(adders.padCount, 'new_build.adders.padCount', systems.length || 0),
      craneAdder: toNonNegativeNumber(adders.craneAdder, 'new_build.adders.craneAdder', 0),
      highCeilingAdder: toNonNegativeNumber(adders.highCeilingAdder, 'new_build.adders.highCeilingAdder', 0),
      longLineSetAdder: toNonNegativeNumber(adders.longLineSetAdder, 'new_build.adders.longLineSetAdder', 0),
      difficultAtticAdder: toNonNegativeNumber(adders.difficultAtticAdder, 'new_build.adders.difficultAtticAdder', 0),
      twoStoryAdder: toNonNegativeNumber(adders.twoStoryAdder, 'new_build.adders.twoStoryAdder', 0),
      premiumGrilleAdder: toNonNegativeNumber(adders.premiumGrilleAdder, 'new_build.adders.premiumGrilleAdder', 0),
      startupCommissioningAdder: toNonNegativeNumber(adders.startupCommissioningAdder, 'new_build.adders.startupCommissioningAdder', 0),
    },
    manualOverrides: {
      equipmentSubtotal:
        manualOverrides.equipmentSubtotal === undefined
          ? undefined
          : toNonNegativeNumber(manualOverrides.equipmentSubtotal, 'new_build.manualOverrides.equipmentSubtotal', 0),
      airDistributionSubtotal:
        manualOverrides.airDistributionSubtotal === undefined
          ? undefined
          : toNonNegativeNumber(manualOverrides.airDistributionSubtotal, 'new_build.manualOverrides.airDistributionSubtotal', 0),
      ventilationSubtotal:
        manualOverrides.ventilationSubtotal === undefined
          ? undefined
          : toNonNegativeNumber(manualOverrides.ventilationSubtotal, 'new_build.manualOverrides.ventilationSubtotal', 0),
      addersSubtotal:
        manualOverrides.addersSubtotal === undefined
          ? undefined
          : toNonNegativeNumber(manualOverrides.addersSubtotal, 'new_build.manualOverrides.addersSubtotal', 0),
      jobCostSubtotal:
        manualOverrides.jobCostSubtotal === undefined
          ? undefined
          : toNonNegativeNumber(manualOverrides.jobCostSubtotal, 'new_build.manualOverrides.jobCostSubtotal', 0),
      lineItems: manualOverrides.lineItems && typeof manualOverrides.lineItems === 'object' ? manualOverrides.lineItems : {},
    },
  };

  const missing = collectModeValidationMissingFields(scope);
  if (missing.length) {
    throw new EstimatorValidationError(
      `Missing required new_build fields for pricing_mode=${scope.pricingMode}`,
      { pricing_mode: scope.pricingMode, missingFields: missing },
    );
  }

  return scope;
}

function addLine(target, line) {
  target.push(line);
  return line;
}

function applyLineOverrides({ selections, manualItems, lineOverrides }) {
  if (!lineOverrides || typeof lineOverrides !== 'object') return;
  for (const selection of selections) {
    const override = lineOverrides[selection.sku];
    if (!override || typeof override !== 'object') continue;
    if (override.quantity !== undefined) {
      selection.quantity = toNonNegativeNumber(override.quantity, `new_build.manualOverrides.lineItems.${selection.sku}.quantity`, selection.quantity || 1) || 1;
    }
    if (override.unitCost !== undefined) {
      selection.unitCostOverride = toNonNegativeNumber(
        override.unitCost,
        `new_build.manualOverrides.lineItems.${selection.sku}.unitCost`,
        selection.unitCostOverride,
      );
    }
    if (override.laborHoursPerUnit !== undefined) {
      selection.laborHoursPerUnitOverride = toNonNegativeNumber(
        override.laborHoursPerUnit,
        `new_build.manualOverrides.lineItems.${selection.sku}.laborHoursPerUnit`,
        selection.laborHoursPerUnitOverride,
      );
    }
  }

  for (const line of manualItems) {
    const override = lineOverrides[line.code];
    if (!override || typeof override !== 'object') continue;
    if (override.quantity !== undefined) {
      line.quantity = toNonNegativeNumber(override.quantity, `new_build.manualOverrides.lineItems.${line.code}.quantity`, line.quantity || 1) || 1;
    }
    if (override.unitCost !== undefined) {
      line.unitCost = toNonNegativeNumber(override.unitCost, `new_build.manualOverrides.lineItems.${line.code}.unitCost`, line.unitCost || 0);
    }
    if (override.laborHoursPerUnit !== undefined) {
      line.laborHoursPerUnit = toNonNegativeNumber(
        override.laborHoursPerUnit,
        `new_build.manualOverrides.lineItems.${line.code}.laborHoursPerUnit`,
        line.laborHoursPerUnit || 0,
      );
    }
  }
}

function buildEquipmentSection(scope, config, catalog) {
  const selections = [];
  const manualItems = [];
  const systemSummary = [];
  let selectionInputCost = 0;
  const tables = scope.pricingTables;
  const modeMultiplier = tables.multipliers.pricingMode[scope.pricingMode] || 1;
  const storiesMultiplier = tables.multipliers.stories[scope.stories] || 1;
  const atticMultiplier = tables.multipliers.atticDifficulty[scope.atticDifficulty] || 1;
  const installType = scope.installType;
  const installHoursPerTon = tables.equipment.installHoursPerTon[installType] || tables.equipment.installHoursPerTon.full_install;

  scope.systems.forEach((system, index) => {
    const catalogItem = inferCatalogEquipmentMatch(system, catalog);
    const tierMultiplier = resolveEquipmentTierMultiplier(system.efficiencyTier, tables.equipment.efficiencyTierMultipliers);
    const equipmentTypeMultiplier =
      tables.equipment.equipmentTypeMultipliers[system.equipmentType] || tables.equipment.equipmentTypeMultipliers.default;
    const heatTypeMultiplier =
      tables.equipment.heatTypeMultipliers[system.heatType] || tables.equipment.heatTypeMultipliers.default;
    const locationMultiplier =
      tables.equipment.locationMultipliers[system.systemLocation] || tables.equipment.locationMultipliers.default;
    const laborDifficultyModifier = system.laborDifficultyModifier || 1;
    const factorBundle = modeMultiplier * storiesMultiplier * atticMultiplier;
    const fallbackEquipmentCost =
      system.tonnage *
      tables.equipment.baseCostPerTon *
      tierMultiplier *
      equipmentTypeMultiplier *
      heatTypeMultiplier *
      factorBundle;
    const laborHours =
      system.tonnage *
      installHoursPerTon *
      locationMultiplier *
      laborDifficultyModifier *
      factorBundle;

    if (catalogItem) {
      selections.push({
        sku: catalogItem.sku,
        quantity: 1,
        notes: `New-build ${system.systemId} (${system.equipmentType}, ${system.tonnage} ton)`,
      });
      selectionInputCost += Number(catalogItem.unitCost || 0);
    } else {
      addLine(
        manualItems,
        createManualLine({
          code: `NB-EQ-${index + 1}`,
          name: `System ${index + 1} equipment (${system.tonnage} ton ${system.equipmentType})`,
          itemType: 'equipment',
          quantity: 1,
          unitCost: fallbackEquipmentCost,
          laborHoursPerUnit: 0,
          taxable: true,
          notes: 'New-build equipment cost (pricing table fallback)',
        }),
      );
    }

    addLine(
      manualItems,
      createManualLine({
        code: `NB-LABOR-${index + 1}`,
        name: `System ${index + 1} install labor`,
        itemType: 'labor',
        quantity: 1,
        unitCost: 0,
        laborHoursPerUnit: laborHours,
        taxable: false,
        notes: `Install type ${scope.installType}`,
      }),
    );

    const thermostatCost =
      tables.accessories.thermostat[normalizeLower(system.thermostatType)] || tables.accessories.thermostat.standard;
    addLine(
      manualItems,
      createManualLine({
        code: `NB-THERM-${index + 1}`,
        name: `System ${index + 1} thermostat (${system.thermostatType || 'standard'})`,
        itemType: 'part',
        quantity: 1,
        unitCost: thermostatCost,
        laborHoursPerUnit: 0,
        taxable: true,
      }),
    );

    const lineSetLength = Number(system.lineSetLength || 0);
    if (lineSetLength > 0) {
      addLine(
        manualItems,
        createManualLine({
          code: `NB-LINESET-${index + 1}`,
          name: `System ${index + 1} line set`,
          itemType: 'part',
          quantity: lineSetLength,
          unitCost: tables.accessories.lineSetPerFoot,
          laborHoursPerUnit: 0,
          taxable: true,
        }),
      );
    }

    const condensateDrainLength = Number(system.condensateDrainLength || 0);
    if (condensateDrainLength > 0) {
      addLine(
        manualItems,
        createManualLine({
          code: `NB-COND-${index + 1}`,
          name: `System ${index + 1} condensate drain`,
          itemType: 'part',
          quantity: condensateDrainLength,
          unitCost: tables.accessories.condensateDrainPerFoot,
          laborHoursPerUnit: 0,
          taxable: true,
        }),
      );
    }

    if (system.filterBaseIncluded) {
      addLine(
        manualItems,
        createManualLine({
          code: `NB-FILTERBASE-${index + 1}`,
          name: `System ${index + 1} filter base`,
          itemType: 'part',
          quantity: 1,
          unitCost: tables.accessories.filterBase,
          laborHoursPerUnit: 0,
          taxable: true,
        }),
      );
    }

    const zoneCount = Number(system.zoneCount || 0);
    if (zoneCount > 0) {
      addLine(
        manualItems,
        createManualLine({
          code: `NB-ZONING-${index + 1}`,
          name: `System ${index + 1} zoning`,
          itemType: 'part',
          quantity: zoneCount,
          unitCost: tables.accessories.zoningPerZone,
          laborHoursPerUnit: 0,
          taxable: true,
        }),
      );
    }

    systemSummary.push({
      systemId: system.systemId,
      equipmentType: system.equipmentType,
      tonnage: system.tonnage,
      heatType: system.heatType,
      efficiencyTier: system.efficiencyTier,
      source: catalogItem ? 'catalog' : 'pricing_table_fallback',
      matchedSku: catalogItem?.sku || null,
    });
  });

  const totalSystems = scope.systems.length;
  const accessoryCounts = {
    pad: scope.adders.padCount || totalSystems,
    disconnect: scope.adders.disconnectCount || totalSystems,
    whip: scope.adders.whipCount || totalSystems,
    condensatePump: scope.adders.condensatePumpCount || 0,
    floatSwitch: scope.adders.floatSwitchCount || 0,
    secondaryDrainPan: scope.adders.secondaryDrainPanCount || 0,
  };

  if (accessoryCounts.pad > 0) {
    addLine(
      manualItems,
      createManualLine({
        code: 'NB-PAD',
        name: 'Equipment pads',
        itemType: 'part',
        quantity: accessoryCounts.pad,
        unitCost: scope.pricingTables.accessories.pad,
      }),
    );
  }
  if (accessoryCounts.disconnect > 0) {
    addLine(
      manualItems,
      createManualLine({
        code: 'NB-DISCONNECT',
        name: 'Disconnects',
        itemType: 'part',
        quantity: accessoryCounts.disconnect,
        unitCost: scope.pricingTables.accessories.disconnect,
      }),
    );
  }
  if (accessoryCounts.whip > 0) {
    addLine(
      manualItems,
      createManualLine({
        code: 'NB-WHIP',
        name: 'Electrical whips',
        itemType: 'part',
        quantity: accessoryCounts.whip,
        unitCost: scope.pricingTables.accessories.whip,
      }),
    );
  }
  if (accessoryCounts.condensatePump > 0) {
    addLine(
      manualItems,
      createManualLine({
        code: 'NB-CONDENSATE-PUMP',
        name: 'Condensate pumps',
        itemType: 'part',
        quantity: accessoryCounts.condensatePump,
        unitCost: scope.pricingTables.accessories.condensatePump,
      }),
    );
  }
  if (accessoryCounts.floatSwitch > 0) {
    addLine(
      manualItems,
      createManualLine({
        code: 'NB-FLOAT-SWITCH',
        name: 'Float switches',
        itemType: 'part',
        quantity: accessoryCounts.floatSwitch,
        unitCost: scope.pricingTables.accessories.floatSwitch,
      }),
    );
  }
  if (accessoryCounts.secondaryDrainPan > 0) {
    addLine(
      manualItems,
      createManualLine({
        code: 'NB-SECONDARY-PAN',
        name: 'Secondary drain pans',
        itemType: 'part',
        quantity: accessoryCounts.secondaryDrainPan,
        unitCost: scope.pricingTables.accessories.secondaryDrainPan,
      }),
    );
  }

  const subtotal = sectionRawCost(manualItems, config.laborRatePerHour) + selectionInputCost;
  return { selections, manualItems, subtotal, systemSummary };
}

function buildAirDistributionSection(scope) {
  const lines = [];
  const air = scope.airDistribution;
  const table = scope.pricingTables.airDistribution;
  const ductMultiplier = scope.pricingTables.multipliers.ductType[scope.ductType] || 1;
  const addCountLine = (code, name, count, unitCost) => {
    const quantity = Number(count || 0);
    if (quantity <= 0) return;
    addLine(
      lines,
      createManualLine({
        code,
        name,
        itemType: 'part',
        quantity,
        unitCost: unitCost * ductMultiplier,
      }),
    );
  };

  addCountLine('NB-AIR-SUPPLY-REG', 'Supply registers', air.supplyRegisterCount, table.supplyRegister);
  addCountLine('NB-AIR-RETURN-GRILLE', 'Return grilles', air.returnGrilleCount, table.returnGrille);
  addCountLine('NB-AIR-RETURN-BOX', 'Return boxes', air.returnBoxCount, table.returnBox);
  addCountLine('NB-AIR-SUPPLY-BOOT', 'Supply boots', air.supplyBootCount, table.supplyBoot);
  addCountLine('NB-AIR-RETURN-BOOT', 'Return boots', air.returnBootCount, table.returnBoot);
  addCountLine('NB-AIR-FLEX-RUN', 'Flex runs', air.flexRunCount, table.flexRun);

  const flexLength = Number(air.flexRunTotalLength || 0);
  if (flexLength > 0) {
    addCountLine('NB-AIR-FLEX-LENGTH', 'Flex duct linear footage', flexLength, table.flexDuctPerFoot);
  }
  const hardDuctFeet = Number(air.hardDuctLinearFeet || 0);
  if (hardDuctFeet > 0) {
    addCountLine('NB-AIR-HARD-DUCT', 'Hard duct linear footage', hardDuctFeet, table.hardDuctPerFoot);
  }
  addCountLine('NB-AIR-TRUNK-14', 'Trunk line 14"', air.trunkLineLinearFeet14, table.trunk14PerFoot);
  addCountLine('NB-AIR-TRUNK-12', 'Trunk line 12"', air.trunkLineLinearFeet12, table.trunk12PerFoot);
  addCountLine('NB-AIR-TRUNK-10', 'Trunk line 10"', air.trunkLineLinearFeet10, table.trunk10PerFoot);
  addCountLine('NB-AIR-TRUNK-8', 'Trunk line 8"', air.trunkLineLinearFeet8, table.trunk8PerFoot);
  addCountLine('NB-AIR-TRANSITION', 'Duct transitions', air.ductTransitionsCount, table.transition);
  addCountLine('NB-AIR-BALANCE-DAMPER', 'Balancing dampers', air.balancingDamperCount, table.balancingDamper);

  const subtotal = sectionRawCost(lines, 0);
  return { manualItems: lines, subtotal };
}

function buildVentilationSection(scope) {
  const lines = [];
  const ventilation = scope.ventilation;
  const table = scope.pricingTables.ventilation;
  const addCountLine = (code, name, count, unitCost) => {
    const quantity = Number(count || 0);
    if (quantity <= 0) return;
    addLine(
      lines,
      createManualLine({
        code,
        name,
        itemType: 'part',
        quantity,
        unitCost,
      }),
    );
  };

  addCountLine('NB-VENT-BATH-FAN', 'Bath fans', ventilation.bathFanCount, table.bathFan);
  addCountLine('NB-VENT-DRYER', 'Dryer vents', ventilation.dryerVentCount, table.dryerVent);
  addCountLine('NB-VENT-RANGE-HOOD', 'Range hood vents', ventilation.rangeHoodVentCount, table.rangeHoodVent);
  addCountLine('NB-VENT-FRESH-AIR', 'Fresh air kits', ventilation.freshAirKitCount, table.freshAirKit);
  addCountLine('NB-VENT-ROOF-CAP', 'Exhaust roof caps', ventilation.exhaustRoofCapCount, table.exhaustRoofCap);
  addCountLine('NB-VENT-WALL-CAP', 'Exhaust wall caps', ventilation.exhaustWallCapCount, table.exhaustWallCap);

  const subtotal = sectionRawCost(lines, 0);
  return { manualItems: lines, subtotal };
}

function buildAddersSection(scope) {
  const lines = [];
  const table = scope.pricingTables.adders;
  const adders = scope.adders;

  const addFixedLine = (code, name, value) => {
    if (!Number.isFinite(value) || value <= 0) return;
    addLine(
      lines,
      createManualLine({
        code,
        name,
        itemType: 'service',
        quantity: 1,
        unitCost: value,
        taxable: false,
      }),
    );
  };

  if (scope.permitRequired) addFixedLine('NB-ADDER-PERMIT', 'Permit adder', table.permit);
  if (scope.craneRequired) addFixedLine('NB-ADDER-CRANE-REQ', 'Crane required adder', table.crane);
  if (scope.atticDifficulty === 'difficult') addFixedLine('NB-ADDER-DIFFICULT-ATTIC-AUTO', 'Difficult attic adder', table.difficultAttic);
  if (scope.stories !== 1) addFixedLine('NB-ADDER-TWO-STORY-AUTO', 'Two-story complexity adder', table.twoStory);

  const longestLineSet = scope.systems.reduce((max, system) => Math.max(max, Number(system.lineSetLength || 0)), 0);
  if (longestLineSet > 50) addFixedLine('NB-ADDER-LONG-LINESET-AUTO', 'Long line-set adder', table.longLineSet);

  addFixedLine('NB-ADDER-CRANE', 'Crane adder', adders.craneAdder);
  addFixedLine('NB-ADDER-HIGH-CEILING', 'High ceiling adder', adders.highCeilingAdder || table.highCeiling);
  addFixedLine('NB-ADDER-LONG-LINESET', 'Long line-set adder', adders.longLineSetAdder);
  addFixedLine('NB-ADDER-DIFFICULT-ATTIC', 'Difficult attic adder', adders.difficultAtticAdder);
  addFixedLine('NB-ADDER-TWO-STORY', 'Two-story adder', adders.twoStoryAdder);
  addFixedLine('NB-ADDER-PREMIUM-GRILLE', 'Premium grille adder', adders.premiumGrilleAdder || scope.pricingTables.airDistribution.premiumGrilleAdder);
  addFixedLine('NB-ADDER-STARTUP', 'Startup / commissioning adder', adders.startupCommissioningAdder || table.startupCommissioning);

  const subtotal = sectionRawCost(lines, 0);
  return { manualItems: lines, subtotal };
}

function applySectionOverride(sectionName, sectionItems, overrideAmount) {
  if (!Number.isFinite(overrideAmount)) return sectionItems;
  return [
    createManualLine({
      code: `NB-OVERRIDE-${sectionName.toUpperCase()}`,
      name: `Manual override - ${sectionName.replace('_', ' ')} subtotal`,
      itemType: 'service',
      quantity: 1,
      unitCost: overrideAmount,
      laborHoursPerUnit: 0,
      taxable: false,
      notes: 'Section subtotal override',
    }),
  ];
}

export function buildNewBuildEstimateInput({ body = {}, profile = {} } = {}) {
  const config = profile.config && typeof profile.config === 'object' ? profile.config : {};
  const catalog = Array.isArray(profile.catalog) ? profile.catalog : [];
  const scope = normalizeNewBuildScope(body);
  const equipmentSection = buildEquipmentSection(scope, config, catalog);
  const airSection = buildAirDistributionSection(scope);
  const ventilationSection = buildVentilationSection(scope);
  const addersSection = buildAddersSection(scope);

  let equipmentItems = [...equipmentSection.manualItems];
  let airItems = [...airSection.manualItems];
  let ventilationItems = [...ventilationSection.manualItems];
  let adderItems = [...addersSection.manualItems];
  const sectionOverridesApplied = {};

  if (Number.isFinite(scope.manualOverrides.equipmentSubtotal)) {
    equipmentItems = applySectionOverride('equipment', equipmentItems, scope.manualOverrides.equipmentSubtotal);
    sectionOverridesApplied.equipment = true;
  }
  if (Number.isFinite(scope.manualOverrides.airDistributionSubtotal)) {
    airItems = applySectionOverride('air_distribution', airItems, scope.manualOverrides.airDistributionSubtotal);
    sectionOverridesApplied.air_distribution = true;
  }
  if (Number.isFinite(scope.manualOverrides.ventilationSubtotal)) {
    ventilationItems = applySectionOverride('ventilation', ventilationItems, scope.manualOverrides.ventilationSubtotal);
    sectionOverridesApplied.ventilation = true;
  }
  if (Number.isFinite(scope.manualOverrides.addersSubtotal)) {
    adderItems = applySectionOverride('adders', adderItems, scope.manualOverrides.addersSubtotal);
    sectionOverridesApplied.adders = true;
  }

  const selections = [...equipmentSection.selections];
  let manualItems = [...equipmentItems, ...airItems, ...ventilationItems, ...adderItems];
  applyLineOverrides({
    selections,
    manualItems,
    lineOverrides: scope.manualOverrides.lineItems,
  });

  if (Number.isFinite(scope.manualOverrides.jobCostSubtotal)) {
    selections.splice(0, selections.length);
    manualItems = [
      createManualLine({
        code: 'NB-OVERRIDE-JOB-SUBTOTAL',
        name: 'Manual override - new build job cost subtotal',
        itemType: 'service',
        quantity: 1,
        unitCost: scope.manualOverrides.jobCostSubtotal,
        laborHoursPerUnit: 0,
        taxable: false,
        notes: 'Job subtotal override',
      }),
    ];
    sectionOverridesApplied.job_cost_subtotal = true;
  }

  const breakdown = {
    estimateType: ESTIMATE_TYPE_NEW_BUILD,
    pricingMode: scope.pricingMode,
    stories: scope.stories,
    atticDifficulty: scope.atticDifficulty,
    installType: scope.installType,
    ductType: scope.ductType,
    systems: equipmentSection.systemSummary,
    sectionInputSubtotals: {
      equipment: Number(scope.manualOverrides.equipmentSubtotal ?? equipmentSection.subtotal),
      airDistribution: Number(scope.manualOverrides.airDistributionSubtotal ?? airSection.subtotal),
      ventilation: Number(scope.manualOverrides.ventilationSubtotal ?? ventilationSection.subtotal),
      adders: Number(scope.manualOverrides.addersSubtotal ?? addersSection.subtotal),
    },
    sectionOverridesApplied,
    notes: [
      'New-build section subtotals represent pre-markup cost inputs.',
      'Final sell price is produced by the shared estimator pricing formula.',
    ],
  };
  breakdown.sectionInputSubtotals.jobCostSubtotal =
    Number(scope.manualOverrides.jobCostSubtotal) ||
    breakdown.sectionInputSubtotals.equipment +
      breakdown.sectionInputSubtotals.airDistribution +
      breakdown.sectionInputSubtotals.ventilation +
      breakdown.sectionInputSubtotals.adders;

  const project = {
    ...(body.project && typeof body.project === 'object' ? body.project : {}),
    summary: normalizeText(body.project?.summary) || scope.projectName || 'Residential new-build HVAC estimate',
    estimateType: ESTIMATE_TYPE_NEW_BUILD,
    pricing_mode: scope.pricingMode,
    builder_name: scope.builderName || undefined,
    square_footage: scope.squareFootage || undefined,
    address: scope.address || body.project?.address,
  };

  return {
    estimateType: ESTIMATE_TYPE_NEW_BUILD,
    pricingMode: scope.pricingMode,
    selections,
    manual_items: manualItems,
    adjustments: body.adjustments && typeof body.adjustments === 'object' ? body.adjustments : {},
    customer: body.customer && typeof body.customer === 'object' ? body.customer : {},
    project,
    new_build: breakdown,
    labor_context: body.labor_context && typeof body.labor_context === 'object' ? body.labor_context : {},
  };
}

export function resolveEstimateMode(input = {}) {
  const estimateType = canonicalEstimateType(input.estimateType ?? input.estimate_type ?? input.project?.estimateType);
  const pricingMode = canonicalPricingMode(input.pricing_mode ?? input.pricingMode ?? input.new_build?.pricing_mode);
  return { estimateType, pricingMode };
}
