# Task 3: Resource Reading Service + API Route

**Sprint:** 6 - Tool Execution & Resource Reading
**Status:** done
**Depends on:** Task 1

## Description

Implement authenticated MCP resource reading with URI-safe request handling, normalized content metadata, and resilient auth/session behavior.

## Steps

1. Create resource reading service module:
   - `lib/mcp/resource-reading.ts`
   - `readResource(serverId, resourceUri)` entrypoint

2. Add resource eligibility checks:
   - Validate requested URI exists in discovered resources when available
   - Provide clear error when resource is unknown or unsupported

3. Implement API route:
   - `POST /api/mcp/[serverId]/resources/read`
   - Request body includes canonical `uri`

4. Normalize content response:
   - Preserve server payload while providing UI-focused fields (`mimeType`, `preview`, `is_truncated`)
   - Handle text, JSON, and unknown/binary-safe fallbacks

5. Standardize failure mapping:
   - `NOT_CONNECTED`, `AUTH_REQUIRED`, `RESOURCE_NOT_FOUND`, `READ_FAILED`

## How to Test

- Read a known resource URI and confirm content + metadata are returned
- Attempt unknown URI and confirm deterministic `RESOURCE_NOT_FOUND` response
- Verify auth/session edge cases match prior MCP lifecycle behavior
- Confirm large payload handling is safe and does not crash response serialization

## Acceptance Criteria

- [x] Resource reading route works end-to-end for connected servers
- [x] URI validation and error mapping are deterministic
- [x] Response shape supports content-aware UI rendering
- [x] Payload handling is safe for large or non-text responses
