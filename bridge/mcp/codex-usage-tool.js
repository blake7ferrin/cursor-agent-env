import { getCodexUsageSummary } from '../codex-usage-store.js';

export async function getUsage(opts = {}) {
  return getCodexUsageSummary(opts.month);
}
