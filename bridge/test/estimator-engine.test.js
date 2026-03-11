import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEstimate, renderEstimateHtml } from '../estimator-engine.js';

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

test('renderEstimateHtml uses branded professional proposal template', () => {
  const estimate = buildEstimate({
    config: {
      currency: 'USD',
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
    catalog: [
      {
        sku: 'MS-24K-TEST',
        name: '24k Ductless Mini Split',
        itemType: 'equipment',
        unitCost: 2400,
        defaultLaborHours: 2,
        taxable: true,
        features: [],
      },
    ],
    selections: [{ sku: 'MS-24K-TEST', quantity: 1 }],
    customer: { name: 'Jonathan Salazar' },
    project: { summary: '24,000 BTU mini-split replacement' },
  });

  const html = renderEstimateHtml(estimate);
  assert.equal(html.includes('HVAC Replacement Proposal'), true);
  assert.equal(html.includes('/assets/branding/polar-air-logo.jpg'), true);
  assert.equal(html.includes("What's Included"), true);
  assert.equal(html.includes('System Options'), true);
});

test('renderEstimateHtml shows new-build breakdown when metadata exists', () => {
  const estimate = buildEstimate({
    config: {
      currency: 'USD',
      laborRatePerHour: 100,
      laborBurdenRate: 0.2,
      overheadRate: 0.15,
      contingencyRate: 0,
      targetGrossMargin: 0.45,
      defaultTaxRate: 0.08,
      defaultPermitFee: 0,
      defaultTripCharge: 0,
      estimateExpirationDays: 30,
      paymentTerms: 'Due on completion',
    },
    catalog: [],
    manual_items: [
      {
        code: 'NB-OVERRIDE-JOB-SUBTOTAL',
        name: 'Manual override - new build job cost subtotal',
        quantity: 1,
        unitCost: 12000,
        laborHoursPerUnit: 0,
        itemType: 'service',
        taxable: false,
      },
    ],
    project: {
      summary: 'New build package',
      estimateType: 'new_build',
      pricing_mode: 'standard',
    },
  });
  estimate.estimate_type = 'new_build';
  estimate.pricing_mode = 'standard';
  estimate.new_build = {
    pricingMode: 'standard',
    systems: [{ systemId: 'SYS-1', equipmentType: 'split', tonnage: 3, heatType: 'gas' }],
    sectionInputSubtotals: {
      equipment: 8000,
      airDistribution: 2200,
      ventilation: 900,
      adders: 900,
      jobCostSubtotal: 12000,
    },
  };

  const html = renderEstimateHtml(estimate);
  assert.equal(html.includes('New Build Breakdown'), true);
  assert.equal(html.includes('Equipment Subtotal'), true);
  assert.equal(html.includes('Pricing Mode'), true);
});
