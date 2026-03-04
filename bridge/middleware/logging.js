/**
 * Request correlation ID and structured logging middleware.
 * Does not log request/response bodies or secrets.
 */

import { randomUUID } from 'node:crypto';

const HEADER_REQUEST_ID = 'x-request-id';

/**
 * Attach request_id to req and res; forward x-request-id if provided.
 */
export function correlationMiddleware(req, res, next) {
  const incoming = req.header(HEADER_REQUEST_ID);
  const requestId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
  req.requestId = requestId;
  res.setHeader(HEADER_REQUEST_ID, requestId);
  next();
}

/**
 * Log at response finish: request_id, user_id, agent_id (if set), route, method, statusCode, latencyMs.
 * Skips logging full body or sensitive payloads.
 */
export function requestLogMiddleware(req, res, next) {
  const start = Date.now();
  const userId = req.body?.user_id ?? req.headers['x-user-id'] ?? '';
  const route = req.route?.path ?? req.path;

  res.on('finish', () => {
    const latencyMs = Date.now() - start;
    const agentId = req.agentId ?? null;
    const logLine = {
      request_id: req.requestId,
      user_id: userId || undefined,
      agent_id: agentId || undefined,
      route,
      method: req.method,
      status: res.statusCode,
      latency_ms: latencyMs,
    };
    if (res.statusCode >= 500) {
      console.error('[bridge]', JSON.stringify(logLine));
    } else {
      console.log('[bridge]', JSON.stringify(logLine));
    }
  });

  next();
}
