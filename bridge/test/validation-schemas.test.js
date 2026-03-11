import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chatBodySchema,
  changeoutPlanBodySchema,
  estimateBodySchema,
  exportHousecallBodySchema,
  housecallRequestBodySchema,
  gdriveUploadBodySchema,
  formatValidationError,
} from '../validation/schemas.js';

test('chatBodySchema accepts valid body with user_id and message', () => {
  const result = chatBodySchema.safeParse({ user_id: 'u1', message: 'Hello' });
  assert.equal(result.success, true);
});

test('chatBodySchema accepts text instead of message', () => {
  const result = chatBodySchema.safeParse({ user_id: 'u1', text: 'Hi' });
  assert.equal(result.success, true);
});

test('chatBodySchema rejects missing user_id', () => {
  const result = chatBodySchema.safeParse({ message: 'Hi' });
  assert.equal(result.success, false);
});

test('chatBodySchema rejects missing message and text', () => {
  const result = chatBodySchema.safeParse({ user_id: 'u1' });
  assert.equal(result.success, false);
});

test('chatBodySchema accepts async flag', () => {
  const result = chatBodySchema.safeParse({ user_id: 'u1', message: 'Hi', async: true });
  assert.equal(result.success, true);
});

test('changeoutPlanBodySchema accepts body with user_id from merge', () => {
  const result = changeoutPlanBodySchema.safeParse({ user_id: 'u1', intake: {} });
  assert.equal(result.success, true);
});

test('estimateBodySchema accepts minimal body', () => {
  const result = estimateBodySchema.safeParse({ user_id: 'u1', selections: [] });
  assert.equal(result.success, true);
});

test('estimateBodySchema accepts labor_context object', () => {
  const result = estimateBodySchema.safeParse({
    user_id: 'u1',
    selections: [],
    labor_context: { weekend_day: 'sat' },
  });
  assert.equal(result.success, true);
});

test('exportHousecallBodySchema accepts body with user_id and customer', () => {
  const result = exportHousecallBodySchema.safeParse({
    user_id: 'u1',
    customer: { name: 'Jane' },
    selections: [],
  });
  assert.equal(result.success, true);
});

test('exportHousecallBodySchema accepts idempotency_key', () => {
  const result = exportHousecallBodySchema.safeParse({
    user_id: 'u1',
    idempotency_key: 'req-abc-123',
    customer: {},
  });
  assert.equal(result.success, true);
});

test('housecallRequestBodySchema requires path', () => {
  const result = housecallRequestBodySchema.safeParse({});
  assert.equal(result.success, false);
});

test('housecallRequestBodySchema accepts valid path', () => {
  const result = housecallRequestBodySchema.safeParse({ path: '/customers' });
  assert.equal(result.success, true);
});

test('housecallRequestBodySchema rejects path not starting with / or http', () => {
  const result = housecallRequestBodySchema.safeParse({ path: 'other' });
  assert.equal(result.success, false);
});

test('gdriveUploadBodySchema accepts required upload fields', () => {
  const result = gdriveUploadBodySchema.safeParse({
    name: 'estimate.pdf',
    content_base64: 'SGVsbG8=',
  });
  assert.equal(result.success, true);
});

test('gdriveUploadBodySchema rejects missing content_base64', () => {
  const result = gdriveUploadBodySchema.safeParse({ name: 'estimate.pdf' });
  assert.equal(result.success, false);
});

test('formatValidationError returns error and details from ZodError', () => {
  const result = chatBodySchema.safeParse({});
  assert.equal(result.success, false);
  const { error, details } = formatValidationError(result.error);
  assert.ok(typeof error === 'string' && error.length > 0);
  assert.ok(Array.isArray(details));
  assert.ok(details.length >= 1);
});
