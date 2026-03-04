import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChangeoutPlan } from '../estimator-changeout.js';

function createProfile() {
  return {
    config: {
      laborRatePerHour: 95,
      laborBurdenRate: 0.3,
      overheadRate: 0.18,
      contingencyRate: 0,
      targetGrossMargin: 0.5,
      minimumGrossMargin: 0.4,
      enforceMinimumGrossMargin: false,
      defaultTaxRate: 0.07,
      defaultPermitFee: 0,
      defaultTripCharge: 0,
      estimateExpirationDays: 30,
      paymentTerms: '50% due at install',
      currency: 'USD',
    },
    catalog: [
      {
        sku: 'ACPRO-HP-4T-18',
        name: 'AC Pro 4 Ton Split Heat Pump 18 SEER2',
        itemType: 'equipment',
        unitCost: 4200,
        defaultLaborHours: 7,
        taxable: true,
        features: ['18 SEER2', '10 year parts warranty'],
        notes: '',
        attributes: {
          brand: 'AC Pro',
          tonnage: 4,
          seer2: 18,
          systemType: 'split_heat_pump',
          phase: 'single',
          vendorContact: 'AC Pro Counter (555-100-2000)',
        },
      },
      {
        sku: 'DAYNIGHT-HP-4T-16',
        name: 'Day & Night 4 Ton Split Heat Pump 16 SEER2',
        itemType: 'equipment',
        unitCost: 3900,
        defaultLaborHours: 7,
        taxable: true,
        features: [],
        notes: '',
        attributes: {
          brand: 'Day & Night',
          tonnage: 4,
          seer2: 16,
          systemType: 'split_heat_pump',
          phase: 'single',
        },
      },
    ],
  };
}

test('changeout plan returns auto_ready with selected matching option', () => {
  const plan = buildChangeoutPlan({
    profile: createProfile(),
    intake: {
      requestedBrand: 'AC Pro',
      tonnage: 4,
      systemType: 'split_heat_pump',
      phase: 'single',
      selectedEquipmentSku: 'ACPRO-HP-4T-18',
      pricingKnown: true,
    },
    customer: { name: 'Jane' },
    project: { summary: 'Replace split heat pump' },
  });

  assert.equal(plan.lane, 'auto_ready');
  assert.ok(plan.draft_estimate_request);
  assert.ok(plan.estimate_preview);
  assert.equal(plan.recommended_options.length >= 1, true);
});

test('changeout plan returns needs_selection when options exist but no selection', () => {
  const plan = buildChangeoutPlan({
    profile: createProfile(),
    intake: {
      requestedBrand: 'AC Pro',
      tonnage: 4,
      systemType: 'split_heat_pump',
      phase: 'single',
    },
  });

  assert.equal(plan.lane, 'needs_selection');
  assert.equal(plan.recommended_options.length >= 1, true);
  assert.equal(plan.estimate_preview, null);
});

test('changeout plan returns awaiting_vendor_quote when no matching options', () => {
  const plan = buildChangeoutPlan({
    profile: createProfile(),
    intake: {
      requestedBrand: 'Trane',
      tonnage: 4,
      systemType: 'split_heat_pump',
      phase: 'single',
    },
  });

  assert.equal(plan.lane, 'awaiting_vendor_quote');
  assert.equal(plan.recommended_options.length, 0);
  assert.equal(plan.follow_up_questions.some((q) => q.toLowerCase().includes('distributor pricing')), true);
});

test('changeout plan returns manual_review for commercial/high complexity', () => {
  const plan = buildChangeoutPlan({
    profile: createProfile(),
    intake: {
      requestedBrand: 'AC Pro',
      tonnage: 4,
      systemType: 'split_heat_pump',
      phase: 'three',
      propertyType: 'commercial',
      selectedEquipmentSku: 'ACPRO-HP-4T-18',
      installConditions: {
        craneRequired: true,
      },
    },
  });

  assert.equal(plan.lane, 'manual_review');
  assert.equal(plan.risk_flags.some((flag) => flag.code === 'commercial_job'), true);
  assert.equal(plan.risk_flags.some((flag) => flag.code === 'crane_required'), true);
});

test('changeout plan returns needs_questions when core sizing fields missing', () => {
  const plan = buildChangeoutPlan({
    profile: createProfile(),
    intake: {
      requestedBrand: 'AC Pro',
      systemType: 'split_heat_pump',
    },
  });

  assert.equal(plan.lane, 'needs_questions');
  assert.equal(plan.missing_fields.includes('tonnage'), true);
});

test('changeout plan maps edge-case adders to catalog when available', () => {
  const profile = createProfile();
  profile.catalog.push({
    sku: 'ADDER-CRANE-CATALOG',
    name: 'Crane and rigging coordination adder',
    itemType: 'service',
    unitCost: 1250,
    defaultLaborHours: 1.5,
    taxable: false,
    features: [],
    notes: 'Use when crane is required for roof access.',
    attributes: {
      sourceCategory: 'Changeout Adders',
      sourceSubcategory: 'Access',
    },
  });

  const plan = buildChangeoutPlan({
    profile,
    intake: {
      requestedBrand: 'AC Pro',
      tonnage: 4,
      systemType: 'split_heat_pump',
      phase: 'single',
      selectedEquipmentSku: 'ACPRO-HP-4T-18',
      pricingKnown: true,
      installConditions: {
        craneRequired: true,
      },
    },
  });

  assert.equal(plan.complexity_adders.length >= 1, true);
  assert.equal(plan.complexity_adders[0].code, 'ADDER-CRANE-CATALOG');
  assert.equal(plan.complexity_adders_resolution[0].source, 'catalog');
});
