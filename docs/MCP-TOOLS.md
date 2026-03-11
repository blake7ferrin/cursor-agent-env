# MCP tools reference

The bridge exposes these tools via:

1. **Stdio MCP server** — run `npm run mcp:stdio` from `bridge/`; a client (e.g. Cursor) spawns it and talks JSON-RPC over stdin/stdout.
2. **HTTP** — when `USE_MCP_TOOLS=true`, `GET /mcp/tools` lists tools and `POST /mcp/call` invokes one (requires bridge auth).
3. **Remote JSON-RPC** — when `USE_MCP_TOOLS=true`, `POST /mcp` supports MCP-style JSON-RPC methods (`initialize`, `tools/list`, `tools/call`) for MCP Registry remote server setups (requires bridge auth).

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
{ "tool": "housecall.test_connection", "arguments": { "path": "/customers" } }
```

---

### housecall.request

Raw Housecall API request (debug). **Disabled** unless `ENABLE_HOUSECALL_DEBUG_REQUEST=true` and `DISABLE_HOUSECALL_REQUEST` is not set.

**Arguments:**

| Name   | Type   | Required | Description |
|--------|--------|----------|-------------|
| path   | string | yes      | Path (e.g. `/customers`) or absolute URL |
| method | string | no       | HTTP method (default GET) |
| query  | object | no       | Query params |
| body   | any    | no       | Request body |
| headers| object | no       | Extra headers |

**Returns:** `{ ok, status, statusText, request: { method, url }, body }`

**Example:**
```json
{ "tool": "housecall.request", "arguments": { "path": "/customers", "method": "GET" } }
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

## gdrive.*

### gdrive.get_config

Returns Google Drive integration config summary (auth mode, folder/scope defaults). No secrets.

**Arguments:** none

**Returns:** `{ authMode, hasServiceAccountJson, hasServiceAccountFields, hasOAuthClientCredentials, hasOAuthRefreshToken, hasAccessToken, folderId, sharedDriveId, useSharedDrive, scopes, apiBase, uploadBase }`

**Example:**
```json
{ "tool": "gdrive.get_config", "arguments": {} }
```

---

### gdrive.list_files

List files in Google Drive with optional query/folder/pagination options.

**Arguments:**

| Name            | Type   | Required | Description |
|-----------------|--------|----------|-------------|
| q               | string | no       | Drive query (e.g. `name contains 'Estimate' and trashed = false`) |
| page_size       | number | no       | Max items per page |
| page_token      | string | no       | Next page token |
| folder_id       | string | no       | Restrict to folder |
| shared_drive_id | string | no       | Shared drive id |
| order_by        | string | no       | Drive ordering expression |
| fields          | string | no       | Drive fields projection |

**Returns:** `{ files: Array<object>, nextPageToken: string|null }`

**Example:**
```json
{ "tool": "gdrive.list_files", "arguments": { "folder_id": "abc123", "page_size": 25 } }
```

---

### gdrive.upload_file

Upload a file to Google Drive from base64 content.

**Arguments:**

| Name            | Type   | Required | Description |
|-----------------|--------|----------|-------------|
| name            | string | yes      | Target filename |
| content_base64  | string | yes      | File content in base64 |
| mime_type       | string | no       | MIME type (default `application/octet-stream`) |
| folder_id       | string | no       | Parent folder id |
| shared_drive_id | string | no       | Shared drive id |

**Returns:** Drive file metadata payload from upload API.

**Example:**
```json
{ "tool": "gdrive.upload_file", "arguments": { "name": "estimate.pdf", "content_base64": "JVBERi0xLjQ..." } }
```

---

### gdrive.download_file

Download a file from Google Drive and return base64 content.

**Arguments:**

| Name            | Type   | Required | Description |
|-----------------|--------|----------|-------------|
| file_id         | string | yes      | Drive file id |
| shared_drive_id | string | no       | Shared drive id |

**Returns:** `{ file_id, mime_type, size, content_base64 }`

**Example:**
```json
{ "tool": "gdrive.download_file", "arguments": { "file_id": "1abcDEF..." } }
```

---

## codex.*

### codex.get_usage

Get codex usage summary (current month by default) including requests, token totals, and estimated USD cost.

**Arguments:**

| Name  | Type   | Required | Description |
|-------|--------|----------|-------------|
| month | string | no       | Month in `YYYY-MM` format |

**Returns:** `{ month, total, by_model, by_route, by_user, updated_at }`

**Example:**
```json
{ "tool": "codex.get_usage", "arguments": { "month": "2026-03" } }
```

---

## HTTP API (when USE_MCP_TOOLS=true)

- **GET /mcp/tools** — List tools (auth required). Response: `{ tools: [ { name, description, inputSchema }, ... ] }`.
- **POST /mcp/call** — Call a tool (auth required). Body: `{ tool: "<name>", arguments: { ... } }` or `{ name, args }`. Response: `{ ok: true, result }` or `{ ok: false, error, code, details? }`.
