# Task 1: OAuth Discovery (RFC 9470 + RFC 8414)

**Sprint:** 3 - OAuth Connect Flow (End-to-End)
**Status:** not_started
**Depends on:** none

## Description

Implement standards-based OAuth discovery so any compatible MCP server can provide its authorization server metadata.

## Steps

1. Create OAuth discovery utilities:
   - `lib/oauth/discovery.ts`
   - `discoverProtectedResourceMetadata(mcpUrl)` for RFC 9470
   - `discoverAuthorizationServerMetadata(authServerUrl)` for RFC 8414

2. Normalize server URL handling:
   - Accept canonical MCP URLs from `lib/servers.ts`
   - Derive protected resource endpoint from server origin
   - Preserve discovered `protected_resource_url` and `authorization_server_url`

3. Validate discovery responses:
   - Ensure `authorization_servers` exists and has at least one URL
   - Ensure auth metadata contains required fields (`authorization_endpoint`, `token_endpoint`)
   - Parse optional fields (`registration_endpoint`, PKCE support fields)

4. Add shared error mapping:
   - Return structured error categories (`DISCOVERY_FAILED`, `INVALID_METADATA`, `UNSUPPORTED_SERVER`)
   - Include provider-safe error messages for UI and logs

5. Add route-level entry point:
   - `POST /api/oauth/discover` accepts `mcp_server_id` or `mcp_url`
   - Returns normalized discovery payload for downstream auth flow

## How to Test

- `POST /api/oauth/discover` for Notion returns authorization and token endpoints
- Discovery handles both base URL and `/mcp` URL inputs
- Invalid/non-OAuth endpoints return a clear 4xx/5xx error payload
- Response shape is stable and typed for later routes

## Acceptance Criteria

- [ ] Discovery follows RFC 9470 then RFC 8414 in order
- [ ] Discovery output includes auth server metadata required by authorize/token routes
- [ ] Error responses are consistent and actionable
- [ ] Notion discovery succeeds end-to-end
