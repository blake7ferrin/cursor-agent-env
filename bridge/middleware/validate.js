/**
 * Validation middleware: run Zod schema on req.body (and optionally merged user_id from header).
 * On failure, respond with 400 and field-level details.
 */

import { formatValidationError } from '../validation/schemas.js';

/**
 * @param {import('zod').ZodSchema} schema
 * @param {{ userIdHeader?: boolean }} options - if true, merge x-user-id into body as user_id for validation
 */
export function validateBody(schema, options = {}) {
  return (req, res, next) => {
    let payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    if (options.userIdHeader && req.headers['x-user-id']) {
      payload = { ...payload, user_id: payload.user_id ?? req.headers['x-user-id'] };
    }
    const result = schema.safeParse(payload);
    if (result.success) {
      req.body = result.data;
      return next();
    }
    const { error, details } = formatValidationError(result.error);
    return res.status(400).json({ error, details });
  };
}
