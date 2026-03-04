# Production Hardening – Change Summary

## Summary

Production-hardening pass on the bridge service: async job mode, request validation, idempotency for Housecall export, Redis-backed state, structured logging, security flag, tests, and README updates. **Existing endpoint contracts and default behavior are preserved.**

---

## 1. Async job mode

- **`POST /chat`** supports `?async=true` or body `"async": true`.
- Response: **202 Accepted** with `job_id`, `agent_id` (null until known), `status_url`.
- **`GET /jobs/:id`** returns job status, result, and error. Requires auth.
- Job state stored in Redis when `REDIS_URL` is set, otherwise in-memory (TTL: `BRIDGE_JOB_TTL_SECONDS`, default 24h).
- Sync behavior remains the default; no change for clients that do not use `async=true`.

## 2. Request/response validation

- **Zod** schemas validate bodies for:
  - `POST /chat`
  - `POST /estimator/changeout-plan`
  - `POST /estimator/estimate`
  - `POST /estimator/export/housecall`
  - `POST /integrations/housecall/request`
- Invalid payloads: **400** with `{ "error": "...", "details": [ { "path": [...], "message": "..." } ] }`.
- `user_id` can come from body or `x-user-id` for estimator/export routes (validation merges header for schema check).

## 3. Idempotency (Housecall export)

- **`Idempotency-Key`** header or **`idempotency_key`** in body on `POST /estimator/export/housecall`.
- Stored per user + route with TTL (`BRIDGE_IDEMPOTENCY_TTL_SECONDS`, default 24h).
- Duplicate key: return **original response** with **`X-Idempotency-Replay: true`**.
- Redis used when `REDIS_URL` is set; otherwise in-memory.

## 4. Persistence/scalability

- **Redis** (`REDIS_URL`) used for:
  - Agent mapping (existing)
  - Rate limits (existing)
  - **Async jobs** (`jobs-store.js`)
  - **Idempotency cache** (`idempotency-store.js`)
- File/in-memory fallback unchanged for local dev without Redis.

## 5. Structured logging and correlation

- **Correlation ID:** `x-request-id` forwarded or generated; echoed in response.
- **Structured log** on response finish: `request_id`, `user_id`, `agent_id` (when set), `route`, `method`, `status`, `latency_ms`. No secrets or full bodies.

## 6. Security

- **`DISABLE_HOUSECALL_REQUEST`** (`true` or `1`): disables `POST /integrations/housecall/request` (e.g. in production). Response: **403** with message.
- Allowlist behavior for orchestrator actions unchanged. Auth and rate limits applied to all sensitive routes as before.

## 7. Tests and docs

- **New tests:** `test/jobs-store.test.js`, `test/idempotency-store.test.js`, `test/validation-schemas.test.js` (async job store, idempotency get/set/duplicate, validation schemas and `formatValidationError`).
- **README:** New endpoints (`GET /jobs/:id`, async chat), env vars (`DISABLE_HOUSECALL_REQUEST`, `BRIDGE_JOB_TTL_SECONDS`, `BRIDGE_IDEMPOTENCY_TTL_SECONDS`, `BRIDGE_PUBLIC_URL`), “Production hardening” section with curl examples, validation, idempotency, logging, security, and compatibility/migration notes.

---

## New/updated files

| File | Purpose |
|------|--------|
| `bridge/jobs-store.js` | Async job create/get/update (Redis + in-memory) |
| `bridge/idempotency-store.js` | Idempotency get/set/check (Redis + in-memory) |
| `bridge/validation/schemas.js` | Zod schemas + formatValidationError |
| `bridge/middleware/logging.js` | Correlation ID + request log middleware |
| `bridge/middleware/validate.js` | validateBody(schema, options) middleware |
| `bridge/test/jobs-store.test.js` | Jobs store unit tests |
| `bridge/test/idempotency-store.test.js` | Idempotency store unit tests |
| `bridge/test/validation-schemas.test.js` | Validation schema tests |
| `bridge/server.js` | Wiring: async chat, GET /jobs, validation, idempotency, logging, DISABLE_HOUSECALL_REQUEST |
| `bridge/README.md` | Endpoints, flags, curl examples, migration notes |
| `bridge/package.json` | Added `zod` dependency |

---

## Risks and follow-ups

- **Validation:** Stricter schemas may reject previously accepted edge cases (e.g. empty string where a string is required). If clients see new 400s, adjust schemas or document allowed shapes.
- **Async jobs:** Background work runs in the same process; no queue or worker process. For very high load, consider a proper job queue and worker.
- **Idempotency race:** Two concurrent requests with the same key can both run the export before either stores the result; idempotency reduces duplicate sends for retries, not strict once-only execution. Optional follow-up: Redis SET NX to claim the key before running.
- **Zod version:** Zod 4 is used; `z.record(z.string(), z.unknown())` is required (Zod 4 record API). Lock Zod version if upgrades cause regressions.
- **Tests:** No integration test that starts the server and calls `POST /chat?async=true` then `GET /jobs/:id` (would require mocking Cursor API or e2e). Current tests cover stores and validation; e2e can be extended later.

---

## Verification

- `npm test` in `bridge/`: all 61 tests pass (including new jobs-store, idempotency-store, validation-schemas).
- Manual smoke test: run bridge, `POST /chat?async=true` → 202 and job_id; `GET /jobs/:id` → job record; sync `POST /chat` unchanged; validation 400 on invalid body; idempotency replay on duplicate key.
