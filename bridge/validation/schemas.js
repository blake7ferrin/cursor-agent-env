/**
 * Request body validation schemas (Zod) for bridge endpoints.
 * Validates required fields and types; allows optional fields for backward compatibility.
 */

import { z } from 'zod';

// ----- /chat -----
export const chatBodySchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  message: z.string().optional(),
  text: z.string().optional(),
  async: z.boolean().optional(),
}).refine((data) => data.message !== undefined || data.text !== undefined, {
  message: 'message or text is required',
  path: ['message'],
});

// ----- /estimator/changeout-plan -----
const optionalObject = z.record(z.string(), z.unknown()).optional();
export const changeoutPlanBodySchema = z.object({
  user_id: z.string().min(1, 'user_id is required').optional(),
  catalog_profile: z.string().optional(),
  use_imported_catalog: z.boolean().optional(),
  include_user_catalog: z.boolean().optional(),
  refresh_import_catalog: z.boolean().optional(),
  intake: optionalObject,
  customer: optionalObject,
  project: optionalObject,
  limit: z.number().optional(),
});

// ----- /estimator/estimate -----
export const estimateBodySchema = z.object({
  user_id: z.string().min(1, 'user_id is required').optional(),
  catalog_profile: z.string().optional(),
  use_imported_catalog: z.boolean().optional(),
  include_user_catalog: z.boolean().optional(),
  refresh_import_catalog: z.boolean().optional(),
  selections: z.array(z.record(z.string(), z.unknown())).optional(),
  manual_items: z.array(z.record(z.string(), z.unknown())).optional(),
  customer: optionalObject,
  project: optionalObject,
  adjustments: optionalObject,
  output: z.enum(['json', 'html']).optional(),
});

// ----- /estimator/export/housecall -----
export const exportHousecallBodySchema = z.object({
  user_id: z.string().min(1, 'user_id is required').optional(),
  idempotency_key: z.string().min(1).optional(),
  customer: optionalObject,
  project: optionalObject,
  estimate: optionalObject,
  selections: z.array(z.record(z.string(), z.unknown())).optional(),
  manual_items: z.array(z.record(z.string(), z.unknown())).optional(),
  housecall: optionalObject,
  adjustments: optionalObject,
  catalog_profile: z.string().optional(),
  use_imported_catalog: z.boolean().optional(),
  include_user_catalog: z.boolean().optional(),
  refresh_import_catalog: z.boolean().optional(),
});

// ----- /integrations/housecall/request -----
export const housecallRequestBodySchema = z.object({
  method: z.string().optional(),
  path: z.string().min(1, 'path is required'),
  query: z.record(z.string(), z.unknown()).optional(),
  body: z.unknown().optional(),
  headers: z.record(z.string(), z.unknown()).optional(),
}).refine((data) => {
  const path = data.path || '';
  return path.startsWith('/') || path.startsWith('https://') || path.startsWith('http://');
}, { message: 'path must start with / or be an absolute URL', path: ['path'] });

/**
 * Format Zod errors into 400 response shape with field-level details.
 * @param {import('zod').ZodError} err
 * @returns {{ error: string, details: Array<{ path: string[], message: string }> }}
 */
export function formatValidationError(err) {
  const issues = err.issues ?? err.errors ?? [];
  const details = issues.map((e) => ({
    path: (e.path || []).map(String),
    message: e.message || 'Invalid value',
  }));
  const first = details[0];
  const error = first ? `${first.path.length ? first.path.join('.') + ': ' : ''}${first.message}` : 'Validation failed';
  return { error, details };
}
