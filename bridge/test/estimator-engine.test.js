import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEstimate } from '../estimator-engine.js';

test('buildEstimate computes totals from catalog selection', () => {
  const estimate = buildEstimate({
    config: {
      currency: 'USD',
      laborRatePerHour: 100,
      laborBurdenRate: 0.3,
      overheadRate: 0.2,
      contingencyRate: 0,
      targetGrossMargin: 0.5,
      defaultTaxRate: 0.07,
      defaultPermitFee: 100,
      defaultTripCharge: 50,
      estimateExpirationDays: 30,
      paymentTerms: 'Due on completion',
    },
    catalog: [
      {
        sku: 'HP-3T-16',
        name: '3 Ton Heat Pump',
        itemType: 'equipment',
        unitCost: 1000,
        defaultLaborHours: 2,
        taxable: true,
        features: ['16 SEER2'],
      },
    ],
    selections: [{ sku: 'HP-3T-16', quantity: 1 }],
    customer: { name: 'Test Customer' },
    project: { summary: 'Replace heat pump' },
  });

  assert.equal(estimate.line_items.length, 1);
  assert.equal(estimate.totals.directCostWithOverhead, 1662);
  assert.equal(estimate.totals.recommendedSubtotal, 3324);
  assert.equal(estimate.totals.taxTotal, 232.68);
  assert.equal(estimate.totals.grandTotal, 3556.68);
  assert.equal(estimate.totals.achievedGrossMargin, 0.5);
  assert.deepEqual(estimate.alerts, []);
});

test('buildEstimate flags margin drop when discounts are applied', () => {
  const estimate = buildEstimate({
    config: {
      currency: 'USD',
      laborRatePerHour: 100,
      laborBurdenRate: 0.3,
      overheadRate: 0.2,
      contingencyRate: 0,
      targetGrossMargin: 0.5,
      defaultTaxRate: 0.07,
      defaultPermitFee: 100,
      defaultTripCharge: 50,
      estimateExpirationDays: 30,
      paymentTerms: 'Due on completion',
    },
    catalog: [
      {
        sku: 'HP-3T-16',
        name: '3 Ton Heat Pump',
        itemType: 'equipment',
        unitCost: 1000,
        defaultLaborHours: 2,
        taxable: true,
        features: [],
      },
    ],
    selections: [{ sku: 'HP-3T-16', quantity: 1 }],
    adjustments: {
      discountPercent: 0.1,
      discountAmount: 100,
    },
  });

  assert.equal(estimate.totals.discountTotal, 432.4);
  assert.equal(estimate.totals.subtotalAfterDiscount, 2891.6);
  assert.equal(estimate.totals.achievedGrossMargin, 0.4252);
  assert.equal(estimate.alerts.length, 1);
});

test('buildEstimate supports non-taxable manual items', () => {
  const estimate = buildEstimate({
    config: {
      currency: 'USD',
      laborRatePerHour: 80,
      laborBurdenRate: 0.2,
      overheadRate: 0.15,
      contingencyRate: 0,
      targetGrossMargin: 0.45,
      defaultTaxRate: 0.1,
      defaultPermitFee: 0,
      defaultTripCharge: 0,
      estimateExpirationDays: 30,
      paymentTerms: 'Due on completion',
    },
    catalog: [],
    manual_items: [
      {
        code: 'MANUAL-LABOR',
        name: 'Duct sealing labor',
        itemType: 'labor',
        quantity: 1,
        unitCost: 0,
        laborHoursPerUnit: 3,
        taxable: false,
      },
    ],
  });

  assert.equal(estimate.line_items.length, 1);
  assert.equal(estimate.totals.taxableSubtotal, 0);
  assert.equal(estimate.totals.taxTotal, 0);
});

test('buildEstimate rejects unknown SKU', () => {
  assert.throws(
    () =>
      buildEstimate({
        config: {
          laborRatePerHour: 100,
          laborBurdenRate: 0.3,
          overheadRate: 0.2,
          contingencyRate: 0,
          targetGrossMargin: 0.5,
          defaultTaxRate: 0.07,
          defaultPermitFee: 0,
          defaultTripCharge: 0,
          estimateExpirationDays: 30,
          paymentTerms: 'Due on completion',
        },
        catalog: [],
        selections: [{ sku: 'MISSING' }],
      }),
    /Unknown SKU/,
  );
});
