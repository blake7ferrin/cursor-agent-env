import test from 'node:test';
import assert from 'node:assert/strict';
import { getHousecallConfigSummary } from '../housecall-pro.js';

function withEnv(overrides, run) {
  const prior = {};
  for (const key of Object.keys(overrides)) {
    prior[key] = process.env[key];
    const next = overrides[key];
    if (next === undefined || next === null) {
      delete process.env[key];
    } else {
      process.env[key] = `${next}`;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Housecall config accepts HCP_API_KEY alias', () => {
  withEnv(
    {
      HOUSECALL_PRO_API_KEY: undefined,
      HCP_API_KEY: 'test-token',
    },
    () => {
      const summary = getHousecallConfigSummary();
      assert.equal(summary.hasApiKey, true);
      assert.equal(summary.authMode, 'api_key');
      assert.equal(summary.apiKeySource, 'HCP_API_KEY');
    },
  );
});

test('Housecall config prefers HOUSECALL_PRO_API_KEY over alias', () => {
  withEnv(
    {
      HOUSECALL_PRO_API_KEY: 'preferred-token',
      HCP_API_KEY: 'alias-token',
    },
    () => {
      const summary = getHousecallConfigSummary();
      assert.equal(summary.hasApiKey, true);
      assert.equal(summary.authMode, 'api_key');
      assert.equal(summary.apiKeySource, 'HOUSECALL_PRO_API_KEY');
    },
  );
});
