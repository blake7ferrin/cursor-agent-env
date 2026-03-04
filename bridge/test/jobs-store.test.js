import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, getJob, updateJob } from '../jobs-store.js';

test('createJob returns a uuid job_id', async () => {
  const id = await createJob({ user_id: 'u1' });
  assert.ok(id);
  assert.match(id, /^[0-9a-f-]{36}$/i);
});

test('getJob returns null for unknown id', async () => {
  const job = await getJob('non-existent-id');
  assert.equal(job, null);
});

test('getJob returns created job with pending status', async () => {
  const id = await createJob({ user_id: 'u2', agent_id: null });
  const job = await getJob(id);
  assert.ok(job);
  assert.equal(job.id, id);
  assert.equal(job.user_id, 'u2');
  assert.equal(job.agent_id, null);
  assert.equal(job.status, 'pending');
  assert.equal(job.result, null);
  assert.equal(job.error, null);
  assert.ok(job.created_at);
});

test('updateJob updates status and result', async () => {
  const id = await createJob({ user_id: 'u3' });
  await updateJob(id, { status: 'running', agent_id: 'agt_1' });
  let job = await getJob(id);
  assert.equal(job.status, 'running');
  assert.equal(job.agent_id, 'agt_1');

  await updateJob(id, { status: 'completed', result: { reply: 'Done' } });
  job = await getJob(id);
  assert.equal(job.status, 'completed');
  assert.deepEqual(job.result, { reply: 'Done' });
});

test('updateJob with error sets failed status', async () => {
  const id = await createJob({ user_id: 'u4' });
  await updateJob(id, { status: 'failed', error: 'Something went wrong' });
  const job = await getJob(id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'Something went wrong');
});
