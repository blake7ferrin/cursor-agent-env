import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentProviderFromEnv } from '../providers/index.js';

function makeJsonResponse(status, payload, extraHeaders = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get(name) {
        const key = Object.keys(extraHeaders).find((k) => k.toLowerCase() === `${name}`.toLowerCase());
        return key ? extraHeaders[key] : null;
      },
    },
    async json() {
      return payload;
    },
  };
}

test('createAgentProviderFromEnv defaults to cursor provider', () => {
  process.env.CURSOR_API_KEY = process.env.CURSOR_API_KEY || 'key-test-placeholder';
  const provider = createAgentProviderFromEnv({ provider: 'cursor' });
  assert.equal(provider.name, 'cursor');
  assert.equal(typeof provider.launchAgent, 'function');
});

test('createAgentProviderFromEnv returns codex provider when selected', () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      makeJsonResponse(200, {
        id: 'resp_bootstrap',
        status: 'completed',
        output_text: 'ok',
        output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
      });
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
    const provider = createAgentProviderFromEnv({ provider: 'codex', apiKey: 'test-openai-key' });
    assert.equal(provider.name, 'codex');
    assert.equal(typeof provider.getAgent, 'function');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createAgentProviderFromEnv rejects unknown provider name', () => {
  assert.throws(
    () => createAgentProviderFromEnv({ provider: 'unknown-provider' }),
    /Unsupported AGENT_PROVIDER=/,
  );
});

test('codex provider launch + followup stores conversation and supports lookups', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      calls.push(body);
      if (calls.length === 1) {
        return makeJsonResponse(200, {
          id: 'resp_1',
          status: 'completed',
          output_text: 'first assistant reply',
          output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'first assistant reply' }] }],
        });
      }
      return makeJsonResponse(200, {
        id: 'resp_2',
        status: 'completed',
        output_text: 'second assistant reply',
        output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'second assistant reply' }] }],
      });
    };

    const provider = createAgentProviderFromEnv({
      provider: 'codex',
      apiKey: 'test-openai-key',
      modelFull: 'gpt-full-test',
      modelMini: 'gpt-mini-test',
    });

    const launch = await provider.launchAgent({ promptText: 'hello world' });
    assert.ok(launch.id);
    assert.equal(launch.status?.state, 'completed');

    const followup = await provider.addFollowup(launch.id, 'followup prompt');
    assert.equal(followup.id, launch.id);

    const agent = await provider.getAgent(launch.id);
    assert.equal(agent.state, 'completed');

    const conversation = await provider.getAgentConversation(launch.id);
    assert.equal(Array.isArray(conversation.messages), true);
    assert.equal(conversation.messages.length, 4);
    assert.equal(conversation.messages[0].role, 'user');
    assert.equal(conversation.messages[0].content, 'hello world');
    assert.equal(conversation.messages[3].content, 'second assistant reply');

    assert.equal(calls[0].model, 'gpt-mini-test');
    assert.equal(calls[0].input, 'hello world');
    assert.equal(launch.model, 'gpt-mini-test');
    assert.equal(launch.route, 'auto_mini_default');
    assert.equal(calls[1].previous_response_id, 'resp_1');
    assert.equal(calls[1].model, 'gpt-mini-test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('codex provider auto-routes complex launch prompts to full model', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      calls.push(body);
      return makeJsonResponse(200, {
        id: 'resp_complex',
        status: 'completed',
        output_text: 'complex done',
        output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'complex done' }] }],
      });
    };

    const provider = createAgentProviderFromEnv({
      provider: 'codex',
      apiKey: 'test-openai-key',
      modelFull: 'gpt-full-test',
      modelMini: 'gpt-mini-test',
      routingMode: 'auto',
    });

    const launch = await provider.launchAgent({
      promptText: 'Please refactor this multi-file architecture and perform a root cause analysis.',
    });
    assert.equal(calls[0].model, 'gpt-full-test');
    assert.equal(launch.model, 'gpt-full-test');
    assert.equal(launch.route, 'auto_full_complex');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('codex provider supports forced routing mode', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      calls.push(body);
      return makeJsonResponse(200, {
        id: 'resp_forced',
        status: 'completed',
        output_text: 'ok',
        output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
      });
    };

    const miniProvider = createAgentProviderFromEnv({
      provider: 'codex',
      apiKey: 'test-openai-key',
      modelFull: 'gpt-full-test',
      modelMini: 'gpt-mini-test',
      routingMode: 'mini',
    });
    await miniProvider.launchAgent({ promptText: 'complex refactor across files' });

    const fullProvider = createAgentProviderFromEnv({
      provider: 'codex',
      apiKey: 'test-openai-key',
      modelFull: 'gpt-full-test',
      modelMini: 'gpt-mini-test',
      routingMode: 'full',
    });
    await fullProvider.launchAgent({ promptText: 'simple summary' });

    assert.equal(calls[0].model, 'gpt-mini-test');
    assert.equal(calls[1].model, 'gpt-full-test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('codex provider maps 429 errors to RATE_LIMITED', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      makeJsonResponse(
        429,
        { error: { message: 'Too many requests' } },
        { 'Retry-After': '17' },
      );

    const provider = createAgentProviderFromEnv({
      provider: 'codex',
      apiKey: 'test-openai-key',
    });

    await assert.rejects(
      provider.launchAgent({ promptText: 'hello' }),
      /RATE_LIMITED:17/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('codex provider returns not found for unknown agent ids', async () => {
  const provider = createAgentProviderFromEnv({
    provider: 'codex',
    apiKey: 'test-openai-key',
  });

  await assert.rejects(provider.getAgent('missing'), /agent not found/);
  await assert.rejects(provider.getAgentConversation('missing'), /agent not found/);
});

test('codex sessions persist across provider instances', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      calls.push(body);
      if (calls.length === 1) {
        return makeJsonResponse(200, {
          id: 'resp_persist_1',
          status: 'completed',
          output_text: 'first',
          output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'first' }] }],
        });
      }
      return makeJsonResponse(200, {
        id: 'resp_persist_2',
        status: 'completed',
        output_text: 'second',
        output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'second' }] }],
      });
    };

    const providerA = createAgentProviderFromEnv({
      provider: 'codex',
      apiKey: 'test-openai-key',
      modelMini: 'gpt-mini-test',
      modelFull: 'gpt-full-test',
      routingMode: 'mini',
    });
    const launched = await providerA.launchAgent({ promptText: 'persist me' });

    const providerB = createAgentProviderFromEnv({
      provider: 'codex',
      apiKey: 'test-openai-key',
      modelMini: 'gpt-mini-test',
      modelFull: 'gpt-full-test',
      routingMode: 'mini',
    });
    const followup = await providerB.addFollowup(launched.id, 'still there?');
    assert.equal(followup.id, launched.id);
    assert.equal(calls[1].previous_response_id, 'resp_persist_1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('codex provider forces mini in auto mode when budget threshold is reached', async () => {
  const calls = [];
  const recordedUsage = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      calls.push(body);
      return makeJsonResponse(200, {
        id: 'resp_budget_1',
        status: 'completed',
        output_text: 'ok',
        usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
        output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
      });
    };

    const provider = createAgentProviderFromEnv({
      provider: 'codex',
      apiKey: 'test-openai-key',
      modelFull: 'gpt-full-test',
      modelMini: 'gpt-mini-test',
      routingMode: 'auto',
      budgetMonthlyUsd: 10,
      budgetForceMiniThresholdPct: 0.8,
      getMonthlyCostUsd: async () => 9,
      recordUsage: async (entry) => {
        recordedUsage.push(entry);
      },
    });

    const launch = await provider.launchAgent({
      promptText: 'Please refactor this multi-file architecture and run root cause analysis.',
      user_id: 'budget-user',
    });

    assert.equal(launch.route, 'budget_force_mini');
    assert.equal(launch.model, 'gpt-mini-test');
    assert.equal(calls[0].model, 'gpt-mini-test');
    assert.equal(recordedUsage.length, 1);
    assert.equal(recordedUsage[0].user_id, 'budget-user');
    assert.equal(recordedUsage[0].model, 'gpt-mini-test');
    assert.ok(recordedUsage[0].cost_usd > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
