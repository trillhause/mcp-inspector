# Task 4: Capabilities Cache + `/api/mcp/[serverId]/capabilities`

**Sprint:** 4 - MCP Capabilities Discovery
**Status:** done
**Depends on:** Task 3

## Description

Persist discovered capabilities in SQLite and expose a capabilities API route that supports cached reads and controlled refresh.

## Steps

1. Implement DB upsert helpers:
   - `lib/mcp/capabilities-store.ts` (or equivalent)
   - Upsert `tools`, `resources`, `prompts`, `last_discovered_at` into `mcp_capabilities`

2. Create capabilities route:
   - `GET /api/mcp/[serverId]/capabilities`
   - Return cached capabilities by default when available

3. Add refresh mode:
   - Support explicit refresh via query param/header (for example `?refresh=1`)
   - Re-run discovery service and persist latest capabilities

4. Standardize response contract:
   - Include counts (`tools_count`, `resources_count`, `prompts_count`)
   - Include `cached` boolean and `last_discovered_at`

5. Add failure handling:
   - Return prior cached data when live refresh fails (when safe)
   - Include clear error metadata for UI messaging

## How to Test

- Call capabilities route after connect and confirm fresh discovery is cached
- Reload page and confirm cached response is returned without redundant live discovery
- Trigger refresh mode and confirm `last_discovered_at` updates
- Force discovery failure and verify fallback behavior with actionable error payload

## Acceptance Criteria

- [x] `mcp_capabilities` is used as durable cache for discovered capabilities
- [x] Capabilities API route returns stable payload for UI consumption
- [x] Explicit refresh path is supported and updates cache
- [x] Cache/read behavior is deterministic and resilient to transient discovery errors
