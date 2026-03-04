/**
 * MCP adapter layer: single entry point for bridge tools.
 * Use these in HTTP routes so internal calls go through the same layer that
 * a future MCP server can expose as tools.
 */

export {
  getConfig as housecallGetConfig,
  housecallRequest,
  testConnection as housecallTestConnection,
  listCustomers as housecallListCustomers,
  resolveAppointmentContext as housecallResolveAppointmentContext,
} from './housecall-tool.js';

export {
  getIngestReport as catalogGetIngestReport,
  loadCatalog as catalogLoadCatalog,
  getItemBySku as catalogGetItemBySku,
  queryByAttribute as catalogQueryByAttribute,
} from './catalog-tool.js';

export { resolveContext as schedulerResolveContext } from './scheduler-context-tool.js';
