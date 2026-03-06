/**
 * MCP adapter: Housecall Pro operations.
 * Wraps housecall-pro.js and housecall-mapper.js for consistent tool-layer access.
 * Used by HTTP routes and (later) by an MCP server exposing these as tools.
 */

import {
  getHousecallConfigSummary,
  housecallRequest as housecallRequestImpl,
  testHousecallConnection as testHousecallConnectionImpl,
  listHousecallCustomers as listHousecallCustomersImpl,
} from '../housecall-pro.js';
import {
  buildHousecallAppointmentLookupRequest,
  extractHousecallIdsFromObject,
} from '../housecall-mapper.js';

export function getConfig() {
  return getHousecallConfigSummary();
}

/**
 * Raw Housecall API request. Use for debug or custom paths.
 * @param {{ method?: string, path: string, query?: object, body?: object, headers?: object }} opts
 */
export async function housecallRequest(opts) {
  return housecallRequestImpl(opts);
}

/**
 * Lightweight auth test (e.g. GET /customers?page_size=1).
 * @param {string} [path]
 */
export async function testConnection(path) {
  return testHousecallConnectionImpl(path);
}

/**
 * List/search customers. Query: { search?, page_size?, page? }.
 * @param {{ search?: string, page_size?: number, page?: number }} query
 */
export async function listCustomers(query = {}) {
  return listHousecallCustomersImpl(query);
}

/**
 * Resolve appointment context: call Housecall appointment lookup path and extract job/estimate/option IDs.
 * @param {{ appointment_id: string, appointment_lookup_path?: string, appointment_lookup_method?: string, appointment_lookup_query?: object }} opts
 * @returns {Promise<{ ok: boolean, status: number, lookup_request: object, extracted_context: object, raw_body?: object }>}
 */
export async function resolveAppointmentContext(opts) {
  const lookupRequest = buildHousecallAppointmentLookupRequest({
    appointment_id: opts.appointment_id ?? opts.appointmentId,
    appointment_lookup_path: opts.appointment_lookup_path ?? opts.appointmentLookupPath,
    appointment_lookup_method: opts.appointment_lookup_method ?? opts.appointmentLookupMethod,
    appointment_lookup_query: opts.appointment_lookup_query ?? opts.appointmentLookupQuery,
  });
  const lookupResponse = await housecallRequestImpl({
    method: lookupRequest.method,
    path: lookupRequest.path,
    query: lookupRequest.query,
  });
  const extracted = extractHousecallIdsFromObject(lookupResponse.body);
  return {
    ok: lookupResponse.ok,
    status: lookupResponse.status,
    lookup_request: lookupRequest,
    extracted_context: extracted,
    raw_body: lookupResponse.body,
  };
}
