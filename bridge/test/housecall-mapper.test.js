import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHousecallAppointmentLookupRequest,
  buildHousecallEstimatePayload,
  buildHousecallExportRequest,
  buildHousecallUpsertPlan,
  extractHousecallIdsFromObject,
} from '../housecall-mapper.js';

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

test('buildHousecallExportRequest infers add_to_job mode from job_id', () => {
  const estimate = createSampleEstimate();
  delete estimate.project.housecall_job_id;
  const request = buildHousecallExportRequest(estimate, {
    job_id: 'job_999',
  });
  assert.equal(request.mode, 'add_to_job');
  assert.equal(request.path, '/v1/jobs/job_999/estimates');
  assert.equal(request.method, 'POST');
});

test('buildHousecallExportRequest infers update_estimate mode from estimate_id', () => {
  const estimate = createSampleEstimate();
  const request = buildHousecallExportRequest(estimate, {
    estimate_id: 'est_999',
  });
  assert.equal(request.mode, 'update_estimate');
  assert.equal(request.path, '/v1/estimates/est_999');
  assert.equal(request.method, 'PATCH');
});

test('buildHousecallExportRequest creates option-note payload when mode is add_option_note', () => {
  const estimate = createSampleEstimate();
  estimate.project.notes = 'Add attic insulation option';
  const request = buildHousecallExportRequest(estimate, {
    mode: 'add_option_note',
    estimate_id: 'est_321',
    estimate_option_id: 'opt_123',
  });
  assert.equal(request.mode, 'add_option_note');
  assert.equal(request.path, '/v1/estimates/est_321/options/opt_123/notes');
  assert.equal(request.method, 'POST');
  assert.equal(request.payload.note, 'Add attic insulation option');
});

test('buildHousecallAppointmentLookupRequest resolves appointment template', () => {
  const lookup = buildHousecallAppointmentLookupRequest({
    appointment_id: 'apt_111',
    appointment_lookup_path: '/v1/schedule/{appointment_id}',
  });
  assert.equal(lookup.method, 'GET');
  assert.equal(lookup.path, '/v1/schedule/apt_111');
});

test('buildHousecallUpsertPlan auto strategy orders update then add_to_job then create', () => {
  const estimate = createSampleEstimate();
  estimate.project.housecall_estimate_id = 'est_222';
  const plan = buildHousecallUpsertPlan(estimate, {});
  assert.equal(plan.strategy, 'auto_upsert');
  assert.equal(plan.requests.length, 3);
  assert.deepEqual(
    plan.requests.map((item) => item.mode),
    ['update_estimate', 'add_to_job', 'create_estimate'],
  );
});

test('buildHousecallUpsertPlan explicit mode uses single request', () => {
  const estimate = createSampleEstimate();
  const plan = buildHousecallUpsertPlan(estimate, {
    mode: 'add_to_job',
    job_id: 'job_123',
  });
  assert.equal(plan.strategy, 'explicit');
  assert.equal(plan.requests.length, 1);
  assert.equal(plan.requests[0].mode, 'add_to_job');
});

test('buildHousecallUpsertPlan supports auto_upsert mode aliases', () => {
  const estimate = createSampleEstimate();
  estimate.project = { summary: 'No linked IDs' };
  const plan = buildHousecallUpsertPlan(estimate, { mode: 'auto' });
  assert.equal(plan.strategy, 'auto_upsert');
  assert.equal(plan.requests.length, 1);
  assert.equal(plan.requests[0].mode, 'create_estimate');
});

test('extractHousecallIdsFromObject extracts nested ids', () => {
  const extracted = extractHousecallIdsFromObject({
    data: {
      job: { id: 'job_111' },
      estimate: { id: 'est_222' },
      option_id: 'opt_333',
      schedule_id: 'apt_444',
    },
  });
  assert.equal(extracted.jobId, 'job_111');
  assert.equal(extracted.estimateId, 'est_222');
  assert.equal(extracted.estimateOptionId, 'opt_333');
  assert.equal(extracted.appointmentId, 'apt_444');
});
