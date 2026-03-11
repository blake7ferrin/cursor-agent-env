/**
 * MCP tool runner: validate args with Zod, call adapters, return consistent envelope.
 * Used by both the stdio MCP server and the HTTP POST /mcp/call route.
 */

import * as mcp from '../mcp/index.js';
import { toolInputSchemas } from './schemas.js';

/**
 * Standard error envelope for tool failures.
 * @typedef {{ ok: false, error: string, code: string, details?: Array<{ path: string[], message: string }> }} ToolErrorEnvelope
 */

/**
 * Success envelope.
 * @typedef {{ ok: true, result: unknown }} ToolSuccessEnvelope
 */

/**
 * @param {import('zod').ZodError} err
 * @returns {{ error: string, details: Array<{ path: string[], message: string }> }}
 */
function formatZodError(err) {
  const issues = err.issues ?? err.errors ?? [];
  const details = issues.map((e) => ({
    path: (e.path || []).map(String),
    message: e.message || 'Invalid value',
  }));
  const first = details[0];
  const error = first ? `${(first.path || []).join('.') ? first.path.join('.') + ': ' : ''}${first.message}` : 'Validation failed';
  return { error, details };
}

/**
 * Run a single tool by name.
 * @param {string} toolName - e.g. housecall.get_config
 * @param {Record<string, unknown>} args - tool arguments (will be validated)
 * @param {{ allowDebugRequest?: boolean }} [options] - allowDebugRequest: allow housecall.request (default false)
 * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: string, code: string, details?: Array<{ path: string[], message: string }> }>}
 */
export async function runTool(toolName, args, options = {}) {
  const allowDebugRequest = options.allowDebugRequest === true;
  const schema = toolInputSchemas[toolName];
  if (!schema) {
    return { ok: false, error: `Unknown tool: ${toolName}`, code: 'UNKNOWN_TOOL' };
  }

  if (toolName === 'housecall.request' && !allowDebugRequest) {
    return {
      ok: false,
      error: 'housecall.request is disabled. Set ENABLE_HOUSECALL_DEBUG_REQUEST=true to enable.',
      code: 'TOOL_DISABLED',
    };
  }

  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    const { error, details } = formatZodError(parsed.error);
    return { ok: false, error, code: 'VALIDATION_ERROR', details };
  }

  const a = parsed.data;

  try {
    switch (toolName) {
      case 'housecall.get_config': {
        const result = mcp.housecallGetConfig();
        return { ok: true, result };
      }
      case 'housecall.test_connection': {
        const result = await mcp.housecallTestConnection(a.path);
        return { ok: true, result: { ok: result.ok, status: result.status, statusText: result.statusText, request: { method: result.method, url: result.url }, body: result.body } };
      }
      case 'housecall.request': {
        const result = await mcp.housecallRequest({
          method: a.method,
          path: a.path,
          query: a.query,
          body: a.body,
          headers: a.headers,
        });
        return { ok: true, result: { ok: result.ok, status: result.status, statusText: result.statusText, request: { method: result.method, url: result.url }, body: result.body } };
      }
      case 'housecall.list_customers': {
        const result = await mcp.housecallListCustomers({
          search: a.search,
          page_size: a.page_size,
          page: a.page,
        });
        return { ok: true, result: result.body ?? result };
      }
      case 'housecall.resolve_context': {
        const result = await mcp.housecallResolveAppointmentContext({
          appointment_id: a.appointment_id,
          appointment_lookup_path: a.appointment_lookup_path,
          appointment_lookup_method: a.appointment_lookup_method,
          appointment_lookup_query: a.appointment_lookup_query,
        });
        return { ok: true, result };
      }
      case 'catalog.get_report': {
        const result = mcp.catalogGetIngestReport();
        return { ok: true, result: result ?? null };
      }
      case 'catalog.load': {
        const result = mcp.catalogLoadCatalog(a.profile || 'preferred');
        return { ok: true, result: { items: result, count: result.length } };
      }
      case 'catalog.get_item_by_sku': {
        const result = mcp.catalogGetItemBySku(a.sku, a.profile || 'preferred');
        return { ok: true, result: result ?? null };
      }
      case 'catalog.query_by_attribute': {
        const result = mcp.catalogQueryByAttribute(a.attribute_key, a.value, a.profile || 'preferred');
        return { ok: true, result: { items: result, count: result.length } };
      }
      case 'scheduler.resolve_context': {
        const result = await mcp.schedulerResolveContext({
          appointment_id: a.appointment_id,
          appointment_lookup_path: a.appointment_lookup_path,
          appointment_lookup_method: a.appointment_lookup_method,
          appointment_lookup_query: a.appointment_lookup_query,
        });
        return { ok: true, result };
      }
      case 'gdrive.get_config': {
        const result = mcp.gdriveGetConfig();
        return { ok: true, result };
      }
      default:
        return { ok: false, error: `Unknown tool: ${toolName}`, code: 'UNKNOWN_TOOL' };
    }
  } catch (err) {
    const message = err?.message || String(err);
    return { ok: false, error: message, code: 'TOOL_ERROR' };
  }
}

/**
 * Return list of tools for MCP tools/list (name, description, inputSchema as JSON Schema).
 */
export function listTools() {
  return [
    { name: 'housecall.get_config', description: 'Get Housecall Pro connector config (auth mode, paths). No arguments.', inputSchema: { type: 'object', properties: {} } },
    { name: 'housecall.test_connection', description: 'Test Housecall API connection (optional path override).', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Optional API path to test' } } } },
    { name: 'housecall.request', description: 'Raw Housecall API request (debug). Disabled unless ENABLE_HOUSECALL_DEBUG_REQUEST=true.', inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, query: { type: 'object' }, body: {}, headers: { type: 'object' } }, required: ['path'] } },
    { name: 'housecall.list_customers', description: 'List or search Housecall customers.', inputSchema: { type: 'object', properties: { search: { type: 'string' }, page_size: { type: 'number' }, page: { type: 'number' } } } },
    { name: 'housecall.resolve_context', description: 'Resolve appointment to job/estimate/option context via Housecall.', inputSchema: { type: 'object', properties: { appointment_id: { type: 'string' }, appointment_lookup_path: { type: 'string' }, appointment_lookup_method: { type: 'string' }, appointment_lookup_query: { type: 'object' } }, required: ['appointment_id'] } },
    { name: 'catalog.get_report', description: 'Get last ingest validation report. No arguments.', inputSchema: { type: 'object', properties: {} } },
    { name: 'catalog.load', description: 'Load catalog items for a profile (default preferred).', inputSchema: { type: 'object', properties: { profile: { type: 'string' } } } },
    { name: 'catalog.get_item_by_sku', description: 'Get a single catalog item by SKU.', inputSchema: { type: 'object', properties: { sku: { type: 'string' }, profile: { type: 'string' } }, required: ['sku'] } },
    { name: 'catalog.query_by_attribute', description: 'Query catalog by attribute key/value.', inputSchema: { type: 'object', properties: { attribute_key: { type: 'string' }, value: { type: 'string' }, profile: { type: 'string' } }, required: ['attribute_key', 'value'] } },
    { name: 'scheduler.resolve_context', description: 'Resolve appointment to job/estimate context (delegates to Housecall).', inputSchema: { type: 'object', properties: { appointment_id: { type: 'string' }, appointment_lookup_path: { type: 'string' }, appointment_lookup_method: { type: 'string' }, appointment_lookup_query: { type: 'object' } }, required: ['appointment_id'] } },
    { name: 'gdrive.get_config', description: 'Get Google Drive integration config summary (auth mode, folder defaults, scopes).', inputSchema: { type: 'object', properties: {} } },
  ];
}
