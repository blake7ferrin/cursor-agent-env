import { createCursorProvider } from './cursor-provider.js';
import { createCodexProvider } from './codex-provider.js';

const SUPPORTED_PROVIDERS = ['cursor', 'codex'];

function normalizeProviderName(value) {
  return `${value || 'cursor'}`.trim().toLowerCase();
}

export function createAgentProviderFromEnv(options = {}) {
  const providerName = normalizeProviderName(options.provider || process.env.AGENT_PROVIDER || 'cursor');

  if (providerName === 'cursor') return createCursorProvider(options);
  if (providerName === 'codex') return createCodexProvider(options);

  throw new Error(
    `Unsupported AGENT_PROVIDER="${providerName}". Supported values: ${SUPPORTED_PROVIDERS.join(', ')}`,
  );
}

export { SUPPORTED_PROVIDERS };
