/**
 * MCP adapter: Scheduler / appointment context.
 * Stub interface for resolving appointment -> job/estimate/option context (e.g. from Housecall schedule API).
 * Used by export flow and (later) by an MCP server as a scheduling-context tool.
 *
 * TODO: Consolidate configuration (appointment_lookup_path, env HOUSECALL_PRO_APPOINTMENT_LOOKUP_PATH).
 * TODO: Add optional caching of resolved context by appointment_id to avoid repeated upstream calls.
 * TODO: Support multiple backends (e.g. other CRMs) when scheduling is externalized.
 */

import { resolveAppointmentContext as resolveAppointmentContextImpl } from './housecall-tool.js';

/**
 * Resolve scheduling context for an appointment: call the configured lookup path and extract job/estimate/option IDs.
 * Delegates to Housecall adapter; other backends can be added later.
 *
 * @param {{ appointment_id: string, appointment_lookup_path?: string, appointment_lookup_method?: string, appointment_lookup_query?: object }} opts
 * @returns {Promise<{ ok: boolean, status: number, lookup_request: object, extracted_context: { jobId?: string, estimateId?: string, estimateOptionId?: string, appointmentId?: string }, raw_body?: object }>}
 */
export async function resolveContext(opts) {
  if (!opts?.appointment_id && !opts?.appointmentId) {
    return {
      ok: false,
      status: 0,
      lookup_request: {},
      extracted_context: {},
      error: 'appointment_id is required',
    };
  }
  return resolveAppointmentContextImpl(opts);
}
