import test from 'node:test';
import assert from 'node:assert/strict';
import { applyInstallerPieceRatePricing, laborContextFromIntake } from '../installer-pricing.js';

const catalog = [
  {
    sku: 'HP-SPLIT-2T',
    name: '2 Ton Heat Pump Split',
    itemType: 'equipment',
    attributes: { systemType: 'split_heat_pump' },
  },
  {
    sku: 'HP-PKG-3T',
    name: '3 Ton Heat Pump Package',
    itemType: 'equipment',
    attributes: { systemType: 'package_unit' },
  },
];

test('applyInstallerPieceRatePricing adds split base labor by default', () => {
  const out = applyInstallerPieceRatePricing({
    selections: [{ sku: 'HP-SPLIT-2T', quantity: 1 }],
    manualItems: [],
    catalog,
  });

  assert.equal(out.enabled, true);
  assert.equal(out.systemType, 'split_heat_pump');
  assert.equal(out.appliedItems.some((item) => item.code === 'LABOR-BASIC-SPLIT-CHANGEOUT'), true);
  assert.equal(out.manualItems.some((item) => item.code === 'LABOR-BASIC-SPLIT-CHANGEOUT'), true);
});

test('applyInstallerPieceRatePricing adds package base labor for package systems', () => {
  const out = applyInstallerPieceRatePricing({
    selections: [{ sku: 'HP-PKG-3T', quantity: 1 }],
    manualItems: [],
    catalog,
  });

  assert.equal(out.systemType, 'package_unit');
  assert.equal(out.appliedItems.some((item) => item.code === 'LABOR-BASIC-PACKAGE-CHANGEOUT'), true);
});

test('applyInstallerPieceRatePricing respects context adders and de-dupes by code', () => {
  const out = applyInstallerPieceRatePricing({
    selections: [{ sku: 'HP-SPLIT-2T', quantity: 1 }],
    manualItems: [{ code: 'ADDER-WEEKEND-SAT', name: 'Already present', quantity: 1, unitCost: 300 }],
    catalog,
    laborContext: {
      weekend_day: 'sat',
      tight_attic: true,
      line_set_replacement: true,
      high_voltage_run: 'over_50',
      new_plenum_boxes_with_install: 2,
    },
  });

  const codes = new Set(out.manualItems.map((item) => item.code));
  assert.equal(codes.has('LABOR-BASIC-SPLIT-CHANGEOUT'), true);
  assert.equal(codes.has('ADDER-WEEKEND-SAT'), true);
  assert.equal(codes.has('ADDER-TIGHT-ATTIC'), true);
  assert.equal(codes.has('ADDER-LINESET-RESIDENTIAL'), true);
  assert.equal(codes.has('ADDER-HIGH-VOLTAGE-OVER-50'), true);
  const plenum = out.manualItems.find((item) => item.code === 'ADDER-PLENUM-WITH-INSTALL');
  assert.equal(Boolean(plenum), true);
  assert.equal(plenum.quantity, 2);
});

test('laborContextFromIntake maps install conditions into labor context', () => {
  const out = laborContextFromIntake({
    weekendDay: 'Sunday',
    installConditions: {
      tightAttic: true,
      lineSetReplacementRequired: true,
      electricalUpgrade: true,
    },
  });

  assert.equal(out.weekend_day, 'Sunday');
  assert.equal(out.tight_attic, true);
  assert.equal(out.line_set_replacement, true);
  assert.equal(out.high_voltage_run, 'under_50');
});
