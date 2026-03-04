# MCP tools reference

The bridge exposes these tools via:

1. **Stdio MCP server** — run `npm run mcp:stdio` from `bridge/`; a client (e.g. Cursor) spawns it and talks JSON-RPC over stdin/stdout.
2. **HTTP** — when `USE_MCP_TOOLS=true`, `GET /mcp/tools` lists tools and `POST /mcp/call` invokes one (requires bridge auth).
3. **HTTP JSON-RPC** — when `USE_MCP_TOOLS=true`, `POST /mcp` accepts MCP JSON-RPC requests (`initialize`, `tools/list`, `tools/call`) for remote MCP registry clients.

All tools use **Zod** for input validation. Errors are returned in a consistent envelope: `{ ok: false, error: string, code: string, details?: array }`. Codes: `UNKNOWN_TOOL`, `VALIDATION_ERROR`, `TOOL_DISABLED`, `TOOL_ERROR`.

---

## housecall.*

### housecall.get_config

Returns Housecall Pro connector config (auth mode, API paths). No secrets.

**Arguments:** none

**Returns:** `{ baseUrl, authMode, hasApiKey, apiKeySource?, hasAccessToken, ... }`

**Example (HTTP):**
```json
POST /mcp/call
{ "tool": "housecall.get_config", "arguments": {} }
```

---

### housecall.test_connection

Lightweight Housecall API connectivity check (e.g. GET with small page_size).

**Arguments:**

| Name | Type   | Required | Description        |
|------|--------|----------|--------------------|
| path | string | no       | Optional path override |

**Returns:** `{ ok, status, statusText, request: { method, url }, body }`

**Example:**
```json
{ "tool": "housecall.test_connection", "arguments": {} }
{ "tool": "housecall.test_connection", "arguments": { "path": "/v1/customers" } }
```

---

### housecall.request

Raw Housecall API request (debug). **Disabled** unless `ENABLE_HOUSECALL_DEBUG_REQUEST=true` and `DISABLE_HOUSECALL_REQUEST` is not set.

**Arguments:**

| Name   | Type   | Required | Description |
|--------|--------|----------|-------------|
| path   | string | yes      | Path (e.g. `/v1/customers`) or absolute URL |
| method | string | no       | HTTP method (default GET) |
| query  | object | no       | Query params |
| body   | any    | no       | Request body |
| headers| object | no       | Extra headers |

**Returns:** `{ ok, status, statusText, request: { method, url }, body }`

**Example:**
```json
{ "tool": "housecall.request", "arguments": { "path": "/v1/customers", "method": "GET" } }
```

---

### housecall.list_customers

List or search Housecall customers.

**Arguments:**

| Name      | Type   | Required | Description |
|-----------|--------|----------|-------------|
| search    | string | no       | Search term |
| page_size | number | no       | Page size   |
| page      | number | no       | Page number |

**Returns:** Housecall API response (e.g. `{ customers: [...] }` or `body` from adapter).

---

### housecall.resolve_context

Resolve an appointment to job/estimate/option IDs by calling the configured Housecall appointment lookup path.

**Arguments:**

| Name                    | Type   | Required | Description          |
|-------------------------|--------|----------|----------------------|
| appointment_id          | string | yes      | Appointment ID       |
| appointment_lookup_path | string | no       | Path template        |
| appointment_lookup_method | string | no     | HTTP method          |
| appointment_lookup_query| object | no       | Query params         |

**Returns:** `{ ok, status, lookup_request, extracted_context: { jobId?, estimateId?, estimateOptionId?, appointmentId? }, raw_body? }`

**Example:**
```json
{ "tool": "housecall.resolve_context", "arguments": { "appointment_id": "apt_123" } }
```

---

## catalog.*

### catalog.get_report

Get the last ingest validation report (profile, files processed, errors). No arguments.

**Arguments:** none

**Returns:** Report object or `null`.

---

### catalog.load

Load catalog items for a profile (default `preferred`).

**Arguments:**

| Name    | Type   | Required | Description      |
|---------|--------|----------|------------------|
| profile | string | no       | Profile name (default `preferred`) |

**Returns:** `{ items: Array<CatalogItem>, count: number }`

---

### catalog.get_item_by_sku

Get a single catalog item by SKU.

**Arguments:**

| Name    | Type   | Required | Description      |
|---------|--------|----------|------------------|
| sku     | string | yes      | SKU              |
| profile | string | no       | Profile (default `preferred`) |

**Returns:** Item object or `null`.

**Example:**
```json
{ "tool": "catalog.get_item_by_sku", "arguments": { "sku": "ING-ABC123" } }
```

---

### catalog.query_by_attribute

Filter catalog by attribute key/value.

**Arguments:**

| Name          | Type   | Required | Description     |
|---------------|--------|----------|-----------------|
| attribute_key | string | yes      | e.g. `brand`, `systemType` |
| value         | string | number | boolean | yes | Value to match |
| profile       | string | no      | Profile (default `preferred`) |

**Returns:** `{ items: Array<CatalogItem>, count: number }`

**Example:**
```json
{ "tool": "catalog.query_by_attribute", "arguments": { "attribute_key": "brand", "value": "AC Pro" } }
```

---

## scheduler.*

### scheduler.resolve_context

Resolve appointment to job/estimate context. Currently delegates to Housecall; same behavior as `housecall.resolve_context` with a stub interface for future backends.

**Arguments:** Same as `housecall.resolve_context` (`appointment_id` required, optional path/method/query).

**Returns:** Same shape as `housecall.resolve_context`; may include `error` on invalid input.

**Example:**
```json
{ "tool": "scheduler.resolve_context", "arguments": { "appointment_id": "apt_456" } }
```

---

## HTTP API (when USE_MCP_TOOLS=true)

- **GET /mcp/tools** — List tools (auth required). Response: `{ tools: [ { name, description, inputSchema }, ... ] }`.
- **POST /mcp/call** — Call a tool (auth required). Body: `{ tool: "<name>", arguments: { ... } }` or `{ name, args }`. Response: `{ ok: true, result }` or `{ ok: false, error, code, details? }`.
- **POST /mcp** — JSON-RPC endpoint (auth required). Body: `{ "jsonrpc":"2.0", "id":1, "method":"tools/list", "params":{} }`.
