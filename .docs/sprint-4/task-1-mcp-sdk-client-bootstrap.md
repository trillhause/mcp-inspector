# Task 1: MCP SDK Client Bootstrap + Authenticated Transport

**Sprint:** 4 - MCP Capabilities Discovery
**Status:** not_started
**Depends on:** none

## Description

Create the baseline MCP client wrapper that can initialize the official SDK client using persisted OAuth credentials for a connected server.

## Steps

1. Create MCP client wrapper module:
   - `lib/mcp/client.ts`
   - Export a typed factory for creating MCP client instances by `mcp_server_id`

2. Resolve server connection context:
   - Load server metadata from `mcp_servers`
   - Load active credentials from `oauth_credentials`
   - Fail fast with structured errors if server is disconnected

3. Add authenticated request plumbing:
   - Inject `Authorization: Bearer <access_token>` for MCP transport calls
   - Keep token handling internal to backend only

4. Normalize runtime connection options:
   - Respect configured transport mode (`auto`, `streamable_http`, `sse`)
   - Prepare shared options used by discovery and future tool/resource calls

5. Add shared error mapping:
   - Return machine-readable categories (`NOT_CONNECTED`, `AUTH_REQUIRED`, `MCP_CONNECT_FAILED`)

## How to Test

- Call a lightweight MCP handshake/test path for a connected server and confirm client initialization succeeds
- Attempt same flow for a disconnected server and confirm clear `NOT_CONNECTED` error
- Verify no token values are logged in server output

## Acceptance Criteria

- [ ] MCP client wrapper exists and is reusable across API routes
- [ ] Connected server credentials are required and validated before client init
- [ ] Authenticated transport requests include bearer token from stored credentials
- [ ] Error shape is consistent with existing OAuth/API patterns
