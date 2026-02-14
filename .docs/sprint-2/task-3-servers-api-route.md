# Task 3: Servers CRUD API Routes

**Sprint:** 2 - Database, API & Live Data
**Status:** not_started
**Depends on:** Task 2

## Description

Implement the server management API used by the app: list servers, create custom servers, and get/update/delete by ID.

## Steps

1. Create collection route:
   - `app/api/servers/route.ts`
   - `GET /api/servers` returns all enabled servers
   - `POST /api/servers` validates and inserts a custom server

2. Create single-resource route:
   - `app/api/servers/[id]/route.ts`
   - `GET /api/servers/[id]` fetches details
   - `PATCH /api/servers/[id]` updates editable fields
   - `DELETE /api/servers/[id]` removes custom server (or soft-disables)

3. Add request validation:
   - Required: `name`, `mcp_url`
   - Validate URL format and allowed transport values
   - Enforce `https://` for non-localhost URLs
   - Accept both base URLs (e.g. `https://mcp.notion.com`) and endpoint URLs (e.g. `https://mcp.notion.com/mcp`)
   - Normalize trailing slash and store canonical URL form to prevent duplicate entries
   - Return consistent JSON error shape on invalid input

4. Add response normalization:
   - Return server shape expected by frontend (`McpServer`)
   - Include deterministic sorting (pre-configured first, then custom)

5. Add Notion/OAuth readiness normalization helpers:
   - Derive origin safely for RFC 9470 discovery at `/.well-known/oauth-protected-resource`
   - Ensure downstream connection code can map canonical URL + `transport=auto` to Streamable HTTP first, then SSE fallback
   - Keep server records/provider handling compatible with OAuth servers that do not expose `registration_endpoint` (dynamic client registration cannot be assumed)

## How to Test

- `GET /api/servers` returns seeded servers
- `POST /api/servers` with valid data creates a new row
- `PATCH /api/servers/:id` updates server fields
- `DELETE /api/servers/:id` removes or disables the row
- Invalid payloads return 4xx with clear error messages
- `POST /api/servers` with `https://mcp.notion.com` and `https://mcp.notion.com/mcp` does not create duplicate logical servers

## Acceptance Criteria

- [ ] `/api/servers` supports `GET` and `POST`
- [ ] `/api/servers/[id]` supports `GET`, `PATCH`, and `DELETE`
- [ ] Input validation prevents malformed URLs and missing required fields
- [ ] URL canonicalization prevents duplicate logical servers caused by path/trailing slash variants
- [ ] API responses are typed/consistent for frontend consumption
- [ ] Core CRUD paths are manually verified end-to-end
