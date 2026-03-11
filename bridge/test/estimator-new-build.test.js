import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNewBuildEstimateInput, resolveEstimateMode } from '../estimator-new-build.js';

const baseProfile = {
  config: {
    laborRatePerHour: 125,
    laborBurdenRate: 0.2,
    overheadRate: 0.15,
    contingencyRate: 0.05,
    targetGrossMargin: 0.4,
    minimumGrossMargin: 0.3,
    defaultTaxRate: 0.09,
    defaultPermitFee: 0,
    defaultTripCharge: 0,
  },
  catalog: [],
};

test('resolveEstimateMode defaults to changeout + standard', () => {
  const mode = resolveEstimateMode({});
  assert.deepEqual(mode, { estimateType: 'changeout', pricingMode: 'standard' });
});

test('buildNewBuildEstimateInput creates sectioned payload for budget mode', () => {
  const result = buildNewBuildEstimateInput({
    body: {
      estimateType: 'new_build',
      pricing_mode: 'budget',
      customer: { name: 'Test Builder' },
      project: { summary: 'New construction HVAC package' },
      new_build: {
        systems: [
          {
            equipmentType: 'split',
            tonnage: 3,
            thermostatType: 'smart',
            lineSetLength: 35,
            condensateDrainLength: 20,
          },
        ],
        airDistribution: {
          supplyRegisterCount: 12,
          returnGrilleCount: 3,
        },
        ventilation: {
          bathFanCount: 2,
        },
      },
    },
    profile: baseProfile,
  });

  assert.equal(result.estimateType, 'new_build');
  assert.equal(result.pricingMode, 'budget');
  assert.ok(Array.isArray(result.manual_items));
  assert.ok(result.manual_items.some((line) => line.code.startsWith('NB-LABOR-')));
  assert.ok(result.new_build.sectionInputSubtotals.equipment > 0);
  assert.ok(result.new_build.sectionInputSubtotals.jobCostSubtotal > 0);
});

test('buildNewBuildEstimateInput validates required fields by pricing mode', () => {
  assert.throws(
    () =>
      buildNewBuildEstimateInput({
        body: {
          estimateType: 'new_build',
          pricing_mode: 'standard',
          new_build: {
            systems: [{ equipmentType: 'split', tonnage: 3 }],
            airDistribution: { supplyRegisterCount: 8, returnGrilleCount: 2 },
            ventilation: {},
          },
        },
        profile: baseProfile,
      }),
    /Missing required new_build fields/,
  );
});

test('buildNewBuildEstimateInput applies job subtotal override', () => {
  const result = buildNewBuildEstimateInput({
    body: {
      estimateType: 'new_build',
      pricing_mode: 'standard',
      new_build: {
        systems: [
          {
            equipmentType: 'split',
            tonnage: 3,
            lineSetLength: 25,
            condensateDrainLength: 15,
          },
        ],
        airDistribution: {
          supplyRegisterCount: 10,
          returnGrilleCount: 2,
          returnBoxCount: 2,
          supplyBootCount: 10,
        },
        ventilation: {
          bathFanCount: 2,
        },
        manualOverrides: {
          jobCostSubtotal: 25000,
        },
      },
    },
    profile: baseProfile,
  });

  assert.equal(result.selections.length, 0);
  assert.equal(result.manual_items.length, 1);
  assert.equal(result.manual_items[0].code, 'NB-OVERRIDE-JOB-SUBTOTAL');
  assert.equal(result.new_build.sectionInputSubtotals.jobCostSubtotal, 25000);
});
