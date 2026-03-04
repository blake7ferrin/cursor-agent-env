import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getIdempotencyResult,
  setIdempotencyResult,
  checkAndStoreIdempotency,
} from '../idempotency-store.js';

test('getIdempotencyResult returns null when no key stored', async () => {
  const result = await getIdempotencyResult('user1', 'key-none');
  assert.equal(result, null);
});

test('setIdempotencyResult then getIdempotencyResult returns stored result', async () => {
  const payload = { estimate: { id: 'est_1' }, housecall_response: { ok: true } };
  await setIdempotencyResult('user1', 'key-1', payload);
  const stored = await getIdempotencyResult('user1', 'key-1');
  assert.deepEqual(stored, payload);
});

test('idempotency is per user and key', async () => {
  await setIdempotencyResult('userA', 'req-1', { a: 1 });
  await setIdempotencyResult('userB', 'req-1', { b: 2 });
  assert.deepEqual(await getIdempotencyResult('userA', 'req-1'), { a: 1 });
  assert.deepEqual(await getIdempotencyResult('userB', 'req-1'), { b: 2 });
  assert.equal(await getIdempotencyResult('userA', 'req-2'), null);
});

test('checkAndStoreIdempotency duplicate returns stored result', async () => {
  await setIdempotencyResult('userD', 'dup-key', { saved: true });
  const out = await checkAndStoreIdempotency('userD', 'dup-key', { new: true });
  assert.equal(out.duplicate, true);
  assert.deepEqual(out.storedResult, { saved: true });
});

test('checkAndStoreIdempotency first request stores and returns duplicate false', async () => {
  const out = await checkAndStoreIdempotency('userE', 'first-key', { result: 42 });
  assert.equal(out.duplicate, false);
  const stored = await getIdempotencyResult('userE', 'first-key');
  assert.deepEqual(stored, { result: 42 });
});
