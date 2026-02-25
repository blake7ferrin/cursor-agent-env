import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHousecallEstimatePayload, buildHousecallExportRequest } from '../housecall-mapper.js';

function createSampleEstimate() {
  return {
    estimate_id: 'est_123',
    currency: 'USD',
    customer: {
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      phone: '555-111-2222',
      housecall_customer_id: 'cust_abc',
    },
    project: {
      summary: 'Replace upstairs heat pump',
      notes: 'Includes haul away',
      housecall_job_id: 'job_123',
    },
    line_items: [
      {
        code: 'HP-3T-16',
        name: '3 Ton Heat Pump',
        itemType: 'equipment',
        quantity: 1,
        taxable: true,
        notes: 'Outdoor condenser',
        features: ['16 SEER2'],
        costs: {
          totalCost: 3200,
          targetSellPrice: 6400,
        },
      },
    ],
    totals: {
      grandTotal: 6848,
      taxRate: 0.07,
      discountTotal: 0,
      achievedGrossMargin: 0.5,
    },
  };
}

test('buildHousecallEstimatePayload maps estimate to Housecall payload shape', () => {
  const payload = buildHousecallEstimatePayload(createSampleEstimate());
  assert.equal(payload.customer_id, 'cust_abc');
  assert.equal(payload.job_id, 'job_123');
  assert.equal(payload.name, 'Replace upstairs heat pump');
  assert.equal(payload.tax_rate, 0.07);
  assert.equal(payload.options.length, 1);
  assert.equal(payload.options[0].line_items.length, 1);
  assert.equal(payload.options[0].line_items[0].unit_price, 6400);
  assert.ok(payload.options[0].line_items[0].description.includes('Code: HP-3T-16'));
});

test('buildHousecallEstimatePayload falls back to nested customer object', () => {
  const estimate = createSampleEstimate();
  delete estimate.customer.housecall_customer_id;
  const payload = buildHousecallEstimatePayload(estimate);
  assert.equal(payload.customer_id, undefined);
  assert.equal(payload.customer.first_name, 'Jane');
  assert.equal(payload.customer.last_name, 'Smith');
});

test('buildHousecallEstimatePayload supports customer.name fallback', () => {
  const estimate = createSampleEstimate();
  estimate.customer = { name: 'Alex Johnson' };
  const payload = buildHousecallEstimatePayload(estimate);
  assert.equal(payload.customer.first_name, 'Alex');
  assert.equal(payload.customer.last_name, 'Johnson');
});

test('buildHousecallExportRequest supports payload override and endpoint override', () => {
  const estimate = createSampleEstimate();
  const request = buildHousecallExportRequest(estimate, {
    endpoint: '/v1/custom-endpoint',
    method: 'put',
    payloadOverride: { hello: 'world' },
  });

  assert.equal(request.path, '/v1/custom-endpoint');
  assert.equal(request.method, 'PUT');
  assert.deepEqual(request.payload, { hello: 'world' });
});
