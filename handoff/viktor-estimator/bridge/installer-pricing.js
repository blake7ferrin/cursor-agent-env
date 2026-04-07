function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return `${value}`.trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === true) return true;
  if (value === false) return false;
  const normalized = normalizeLower(value);
  if (!normalized) return defaultValue;
  return ['true', '1', 'yes', 'y'].includes(normalized);
}

function normalizeInteger(value, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const numeric = Number.parseInt(`${value}`, 10);
  if (!Number.isFinite(numeric) || numeric < 0) return defaultValue;
  return numeric;
}

function normalizeMoney(value, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const numeric = Number(`${value}`.replace(/[$,]/g, ''));
  if (!Number.isFinite(numeric) || numeric < 0) return defaultValue;
  return numeric;
}

function normalizeSystemType(value) {
  const normalized = normalizeLower(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.includes('package')) return 'package_unit';
  if (normalized.includes('heat pump') || normalized === 'hp') return 'split_heat_pump';
  if (normalized.includes('gas') && normalized.includes('split')) return 'split_ac_furnace';
  if (normalized.includes('air conditioner') || normalized.includes('split ac') || normalized === 'ac') return 'split_ac';
  return normalized.replace(/\s+/g, '_');
}

function normalizeWeekendDay(value) {
  const normalized = normalizeLower(value);
  if (!normalized) return '';
  if (['sat', 'saturday'].includes(normalized)) return 'sat';
  if (['sun', 'sunday'].includes(normalized)) return 'sun';
  return '';
}

function createLaborItem(definition) {
  return {
    code: definition.code,
    name: definition.name,
    itemType: definition.itemType || 'labor',
    quantity: definition.quantity ?? 1,
    unitCost: definition.unitCost,
    laborHoursPerUnit: 0,
    taxable: false,
    notes: 'Installer piece-rate labor',
  };
}

function createMaterialItem(definition) {
  return {
    code: definition.code,
    name: definition.name,
    itemType: definition.itemType || 'part',
    quantity: definition.quantity ?? 1,
    unitCost: definition.unitCost,
    laborHoursPerUnit: 0,
    taxable: true,
    notes: 'Installer material allowance',
  };
}

function inferEquipmentSystemType(selections = [], catalog = []) {
  const catalogBySku = new Map((Array.isArray(catalog) ? catalog : []).map((item) => [item.sku, item]));
  for (const selection of Array.isArray(selections) ? selections : []) {
    const sku = normalizeText(selection?.sku);
    if (!sku) continue;
    const item = catalogBySku.get(sku);
    if (!item || item.itemType !== 'equipment') continue;
    const systemTypeFromAttributes = normalizeSystemType(item.attributes?.systemType || item.attributes?.system_type);
    if (systemTypeFromAttributes) return systemTypeFromAttributes;
    const systemTypeFromName = normalizeSystemType(item.name);
    if (systemTypeFromName) return systemTypeFromName;
  }
  return '';
}

function dedupeByCode(items = []) {
  const existingCodes = new Set();
  const output = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const code = normalizeText(item.code).toUpperCase();
    if (code) existingCodes.add(code);
    output.push(item);
  }
  return { existingCodes, output };
}

function itemContainsAnyToken(item, tokens = []) {
  if (!item || typeof item !== 'object') return false;
  const blob = `${normalizeLower(item.code)} ${normalizeLower(item.name)}`;
  return tokens.some((token) => blob.includes(token));
}

function hasSemanticOverlap(existingItems = [], source = '') {
  const semanticRules = {
    tight_attic: ['adder-tight-attic', 'tight attic', 'attic access', 'restricted attic', 'crawl access'],
    line_set_residential: ['adder-lineset', 'lineset', 'line set', 'line-set'],
    high_voltage_under_50: ['adder-electrical', 'high voltage', 'electrical', 'breaker', 'disconnect', 'wire', 'conductor'],
    high_voltage_over_50: ['adder-electrical', 'high voltage', 'electrical', 'breaker', 'disconnect', 'wire', 'conductor'],
  };
  const tokens = semanticRules[source] || [];
  if (!tokens.length) return false;
  return (Array.isArray(existingItems) ? existingItems : []).some((item) => itemContainsAnyToken(item, tokens));
}

function resolveBaseLaborDefinition(systemTypeCanonical) {
  if (systemTypeCanonical === 'package_unit') {
    return {
      code: 'LABOR-BASIC-PACKAGE-CHANGEOUT',
      name: 'Installer labor - basic package changeout',
      unitCost: 1000,
      itemType: 'labor',
      source: 'base_package_changeout',
    };
  }
  if (['split_heat_pump', 'split_ac_furnace', 'split_ac'].includes(systemTypeCanonical)) {
    return {
      code: 'LABOR-BASIC-SPLIT-CHANGEOUT',
      name: 'Installer labor - basic split changeout',
      unitCost: 1400,
      itemType: 'labor',
      source: 'base_split_changeout',
    };
  }
  if (systemTypeCanonical === 'mini_split') {
    return {
      code: 'LABOR-BASIC-MINI-SPLIT-CHANGEOUT',
      name: 'Installer labor - basic mini-split install',
      unitCost: 1200,
      itemType: 'labor',
      source: 'base_mini_split_changeout',
    };
  }
  return null;
}

function resolveAdderDefinitions(laborContext = {}) {
  const weekendDay = normalizeWeekendDay(
    laborContext.weekend_day || laborContext.weekendDay || laborContext.install_day || laborContext.installDay,
  );
  const adders = [];
  if (weekendDay === 'sat') {
    adders.push({
      code: 'ADDER-WEEKEND-SAT',
      name: 'Weekend install adder (Saturday)',
      unitCost: 300,
      itemType: 'labor',
      source: 'weekend_sat',
    });
  }
  if (weekendDay === 'sun') {
    adders.push({
      code: 'ADDER-WEEKEND-SUN',
      name: 'Weekend install adder (Sunday)',
      unitCost: 600,
      itemType: 'labor',
      source: 'weekend_sun',
    });
  }
  if (normalizeBoolean(laborContext.tight_attic || laborContext.tightAttic)) {
    adders.push({
      code: 'ADDER-TIGHT-ATTIC',
      name: 'Tight attic installer adder',
      unitCost: 250,
      itemType: 'labor',
      source: 'tight_attic',
    });
  }
  if (
    normalizeBoolean(
      laborContext.tight_attic_rebuild ||
        laborContext.tightAtticRebuild ||
        laborContext.rebuild_in_attic ||
        laborContext.rebuildInAttic,
    )
  ) {
    adders.push({
      code: 'ADDER-TIGHT-ATTIC-REBUILD',
      name: 'Tight attic rebuild installer adder',
      unitCost: 300,
      itemType: 'labor',
      source: 'tight_attic_rebuild',
    });
  }
  if (normalizeBoolean(laborContext.line_set_replacement || laborContext.lineSetReplacement)) {
    adders.push({
      code: 'ADDER-LINESET-RESIDENTIAL',
      name: 'Residential copper line-set installer adder',
      unitCost: 500,
      itemType: 'labor',
      source: 'line_set_residential',
    });
  }

  const highVoltageRun = normalizeLower(laborContext.high_voltage_run || laborContext.highVoltageRun);
  if (highVoltageRun === 'over_50' || highVoltageRun === 'over50') {
    adders.push({
      code: 'ADDER-HIGH-VOLTAGE-OVER-50',
      name: 'High voltage run (>50ft) installer adder',
      unitCost: 600,
      itemType: 'labor',
      source: 'high_voltage_over_50',
    });
  } else if (
    highVoltageRun === 'under_50' ||
    highVoltageRun === 'under50' ||
    normalizeBoolean(laborContext.high_voltage_under_50 || laborContext.highVoltageUnder50)
  ) {
    adders.push({
      code: 'ADDER-HIGH-VOLTAGE-UNDER-50',
      name: 'High voltage run (<=50ft) installer adder',
      unitCost: 500,
      itemType: 'labor',
      source: 'high_voltage_under_50',
    });
  }

  const plenumWithInstall = normalizeInteger(
    laborContext.new_plenum_boxes_with_install || laborContext.newPlenumBoxesWithInstall,
    0,
  );
  if (plenumWithInstall > 0) {
    adders.push({
      code: 'ADDER-PLENUM-WITH-INSTALL',
      name: 'New plenum box adder (with install)',
      unitCost: 150,
      quantity: plenumWithInstall,
      itemType: 'labor',
      source: 'plenum_with_install',
    });
  }

  const plenumWithoutInstall = normalizeInteger(
    laborContext.new_plenum_boxes_without_install || laborContext.newPlenumBoxesWithoutInstall,
    0,
  );
  if (plenumWithoutInstall > 0) {
    adders.push({
      code: 'ADDER-PLENUM-WITHOUT-INSTALL',
      name: 'New plenum box adder (standalone)',
      unitCost: 300,
      quantity: plenumWithoutInstall,
      itemType: 'labor',
      source: 'plenum_without_install',
    });
  }

  return adders;
}

function resolveMaterialDefinitions(laborContext = {}) {
  const lineSetMaterialCost = normalizeMoney(
    laborContext.line_set_material_cost ?? laborContext.lineSetMaterialCost,
    0,
  );
  const lineSetCoverMaterialCost = normalizeMoney(
    laborContext.line_set_cover_material_cost ?? laborContext.lineSetCoverMaterialCost,
    0,
  );
  const miscMaterialCost = normalizeMoney(
    laborContext.misc_material_cost ?? laborContext.miscMaterialCost ?? laborContext.random_material_cost,
    0,
  );
  const disconnectMaterialCost = normalizeMoney(
    laborContext.disconnect_material_cost ?? laborContext.disconnectMaterialCost,
    0,
  );
  const padMaterialCost = normalizeMoney(
    laborContext.pad_material_cost ?? laborContext.padMaterialCost,
    0,
  );
  const condensateMaterialCost = normalizeMoney(
    laborContext.condensate_material_cost ?? laborContext.condensateMaterialCost,
    0,
  );

  const defs = [];
  if (lineSetMaterialCost > 0) {
    defs.push({
      code: 'MAT-LINESET',
      name: 'Line-set material allowance',
      unitCost: lineSetMaterialCost,
      itemType: 'part',
      source: 'line_set_material',
    });
  }
  if (lineSetCoverMaterialCost > 0) {
    defs.push({
      code: 'MAT-LINESET-COVER',
      name: 'Line-set cover material allowance',
      unitCost: lineSetCoverMaterialCost,
      itemType: 'part',
      source: 'line_set_cover_material',
    });
  }
  if (disconnectMaterialCost > 0) {
    defs.push({
      code: 'MAT-DISCONNECT',
      name: 'Disconnect/whip material allowance',
      unitCost: disconnectMaterialCost,
      itemType: 'part',
      source: 'disconnect_material',
    });
  }
  if (padMaterialCost > 0) {
    defs.push({
      code: 'MAT-EQUIPMENT-PAD',
      name: 'Equipment pad material allowance',
      unitCost: padMaterialCost,
      itemType: 'part',
      source: 'pad_material',
    });
  }
  if (condensateMaterialCost > 0) {
    defs.push({
      code: 'MAT-CONDENSATE-DRAIN',
      name: 'Condensate drain material allowance',
      unitCost: condensateMaterialCost,
      itemType: 'part',
      source: 'condensate_material',
    });
  }
  if (miscMaterialCost > 0) {
    defs.push({
      code: 'MAT-MISC',
      name: 'Misc install material allowance',
      unitCost: miscMaterialCost,
      itemType: 'part',
      source: 'misc_material',
    });
  }
  return defs;
}

export function laborContextFromIntake(intake = {}) {
  const source = intake && typeof intake === 'object' ? intake : {};
  const explicitContext =
    source.labor_context && typeof source.labor_context === 'object' ? source.labor_context : {};
  const installConditions =
    source.installConditions && typeof source.installConditions === 'object' ? source.installConditions : {};

  const weekendDay = source.weekend_day || source.weekendDay || explicitContext.weekend_day || explicitContext.weekendDay;
  return {
    ...explicitContext,
    weekend_day: weekendDay || '',
    tight_attic:
      explicitContext.tight_attic ??
      explicitContext.tightAttic ??
      (installConditions.tightAttic === true ? true : undefined),
    line_set_replacement:
      explicitContext.line_set_replacement ??
      explicitContext.lineSetReplacement ??
      (installConditions.lineSetReplacementRequired === true ? true : undefined),
    high_voltage_run:
      explicitContext.high_voltage_run ??
      explicitContext.highVoltageRun ??
      (installConditions.electricalUpgrade === true ? 'under_50' : undefined),
    line_set_material_cost:
      explicitContext.line_set_material_cost ??
      explicitContext.lineSetMaterialCost ??
      source.line_set_material_cost ??
      source.lineSetMaterialCost,
    line_set_cover_material_cost:
      explicitContext.line_set_cover_material_cost ??
      explicitContext.lineSetCoverMaterialCost ??
      source.line_set_cover_material_cost ??
      source.lineSetCoverMaterialCost,
    misc_material_cost:
      explicitContext.misc_material_cost ??
      explicitContext.miscMaterialCost ??
      source.misc_material_cost ??
      source.miscMaterialCost,
    disconnect_material_cost:
      explicitContext.disconnect_material_cost ??
      explicitContext.disconnectMaterialCost ??
      source.disconnect_material_cost ??
      source.disconnectMaterialCost,
    pad_material_cost:
      explicitContext.pad_material_cost ??
      explicitContext.padMaterialCost ??
      source.pad_material_cost ??
      source.padMaterialCost,
    condensate_material_cost:
      explicitContext.condensate_material_cost ??
      explicitContext.condensateMaterialCost ??
      source.condensate_material_cost ??
      source.condensateMaterialCost,
  };
}

export function applyInstallerPieceRatePricing({
  selections = [],
  manualItems = [],
  catalog = [],
  laborContext = {},
  autoAddBaseLabor = true,
} = {}) {
  const context = laborContext && typeof laborContext === 'object' ? laborContext : {};
  const includePricing =
    context.auto_add_installer_labor === undefined && context.autoAddInstallerLabor === undefined
      ? autoAddBaseLabor
      : normalizeBoolean(context.auto_add_installer_labor ?? context.autoAddInstallerLabor, autoAddBaseLabor);
  const dedupe = dedupeByCode(manualItems);
  const outputItems = [...dedupe.output];
  const appliedItems = [];

  if (!includePricing) {
    return {
      laborContext: context,
      manualItems: outputItems,
      appliedItems,
      enabled: false,
      skippedReason: 'auto_add_installer_labor=false',
    };
  }

  const systemType = inferEquipmentSystemType(selections, catalog);
  const baseLabor = resolveBaseLaborDefinition(systemType);
  if (baseLabor && !dedupe.existingCodes.has(baseLabor.code)) {
    const next = createLaborItem(baseLabor);
    outputItems.push(next);
    dedupe.existingCodes.add(baseLabor.code);
    appliedItems.push({ ...baseLabor, quantity: next.quantity });
  }

  const adders = resolveAdderDefinitions(context);
  for (const adder of adders) {
    if (dedupe.existingCodes.has(adder.code)) continue;
    if (hasSemanticOverlap(outputItems, adder.source)) continue;
    const next = createLaborItem(adder);
    outputItems.push(next);
    dedupe.existingCodes.add(adder.code);
    appliedItems.push({ ...adder, quantity: next.quantity });
  }

  const materials = resolveMaterialDefinitions(context);
  for (const material of materials) {
    if (dedupe.existingCodes.has(material.code)) continue;
    const next = createMaterialItem(material);
    outputItems.push(next);
    dedupe.existingCodes.add(material.code);
    appliedItems.push({ ...material, quantity: next.quantity, taxable: true });
  }

  return {
    laborContext: context,
    manualItems: outputItems,
    appliedItems,
    enabled: true,
    systemType,
  };
}
