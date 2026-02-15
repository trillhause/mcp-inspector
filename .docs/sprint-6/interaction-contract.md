# Sprint 6 — Tool/Resource Interaction Contract

This document defines the execution/read interaction model and API shapes for Sprint 6. It is the source of truth for Tasks 2–6.

---

## 1. Interaction Lifecycle Contract

### Tool execution state machine (UI)

`idle` → `validating` → `executing` → (`success` | `error`)

- `idle`: no pending request for selected tool
- `validating`: client-side best-effort validation of authored params
- `executing`: request submitted to backend route, action controls disabled
- `success`: backend returns successful execution envelope
- `error`: backend returns structured API error envelope

### Resource read state machine (UI)

`idle` → `executing` → (`success` | `error`)

- `idle`: no pending read request for selected resource
- `executing`: read request in flight
- `success`: content payload returned
- `error`: structured API error returned

Client-side validation is UX guidance only. Server-side validation is authoritative.

---

## 2. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/mcp/[serverId]/tools/[toolName]/execute` | `POST` | Execute a discovered MCP tool with JSON arguments |
| `/api/mcp/[serverId]/resources/read` | `POST` | Read a discovered MCP resource by URI |

Both routes are `runtime = "nodejs"` and require the server to be connected/authenticated.

---

## 3. Request Shapes

### Tool execute request

```json
{
  "arguments": {
    "query": "roadmap",
    "limit": 5
  }
}
```

- `arguments`: optional JSON object, defaults to `{}` server-side
- Reject non-object payloads with `INVALID_REQUEST`
- Reject oversized payloads with `VALIDATION_ERROR`

### Resource read request

```json
{
  "uri": "notion://pages/123"
}
```

- `uri`: required non-empty string
- Reject non-string/empty `uri` with `INVALID_REQUEST`

---

## 4. Shared Response Envelope

Both endpoints return a normalized envelope with shared metadata for UI rendering and history:

```json
{
  "mcp_server_id": "notion",
  "target": { "type": "tool", "tool_name": "search" },
  "status": "success",
  "latency_ms": 142,
  "content_type": "application/json",
  "executed_at": "2026-02-15T18:22:44.100Z"
}
```

### Success payloads

- Tool execute success adds:
  - `result`: raw MCP tool result payload (sanitized JSON-safe)
- Resource read success adds:
  - `result`: raw MCP resource read payload (JSON-safe)
  - `content_type`: normalized from resource metadata when present

### Error payloads

Non-2xx responses use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "category": "validation",
    "message": "Tool arguments failed validation",
    "details": ["field=query must be a string"]
  }
}
```

`error.code` remains machine-readable and deterministic. `error.category` is the stable grouping for UI handling.

---

## 5. Error Taxonomy

| Code | Category | Typical HTTP Status | Meaning |
|------|----------|---------------------|---------|
| `INVALID_REQUEST` | `validation` | `400` | Body/shape parse failure |
| `VALIDATION_ERROR` | `validation` | `422` | Business/schema validation failure |
| `NOT_CONNECTED` | `connection` | `404` or `409` | Server or OAuth credentials unavailable |
| `AUTH_REQUIRED` | `auth` | `401` | Access token invalid and refresh failed |
| `RECONNECT_REQUIRED` | `auth` | `401` | Credentials cannot be refreshed and require reconnect |
| `TOOL_NOT_FOUND` | `not_found` | `404` | Requested tool not present in discovered capabilities |
| `RESOURCE_NOT_FOUND` | `not_found` | `404` | Requested URI not present in discovered resources |
| `MCP_CONNECT_FAILED` | `connection` | `502` | MCP transport/session bootstrap failure |
| `EXECUTION_FAILED` | `execution` | `502` | MCP tool call failed after session established |
| `READ_FAILED` | `execution` | `502` | MCP resource read failed after session established |
| `INTERNAL_ERROR` | `internal` | `500` | Unexpected server failure |

---

## 6. Validation Boundaries

- Client:
  - Derives form fields from `inputSchema`
  - Performs non-authoritative checks (required fields, primitive type hints)
  - Never trusted for schema fidelity or authorization
- Server:
  - Re-resolves capabilities and validates target tool/resource existence
  - Validates request body shape and limits
  - Treats client-submitted schema metadata as untrusted input

---

## 7. Normalization Rules

- Preserve raw MCP result payloads when JSON-safe
- Include shared summary metadata:
  - `status`
  - `latency_ms`
  - `content_type`
  - `executed_at`
- Normalize unknown/unmappable content types to `null`
- Include deterministic `error.code` + `error.category` for non-2xx responses

---

## 8. Explicit Non-Goals (Sprint 6)

- No provider-specific hardcoded forms or execution logic
- No write/update/mutation resource workflows
- No prompt execution API in this sprint
- No long-term job queueing or async execution polling
