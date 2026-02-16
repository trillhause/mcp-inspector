# Task 3: Callback Handling + Token Exchange Storage

**Sprint:** 3 - OAuth Connect Flow (End-to-End)
**Status:** done
**Depends on:** Task 2

## Description

Handle OAuth callback safely: validate state, exchange authorization code for tokens, and persist credentials for the selected MCP server.

## Steps

1. Add callback route:
   - `app/api/oauth/callback/route.ts`
   - Accept `code`, `state`, and provider error params

2. Validate callback inputs:
   - Reject missing/expired state
   - Compare callback state with stored `oauth_state.state_value`
   - Return explicit error for CSRF/state mismatch

3. Exchange code for tokens:
   - Use discovered `token_endpoint`
   - Include `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`, and optional `client_secret`
   - Parse `access_token`, `refresh_token`, `expires_in`, `scope`

4. Persist OAuth credentials:
   - Upsert into `oauth_credentials` by `mcp_server_id`
   - Store `oauth_metadata`, `protected_resource_url`, `authorization_server_url`
   - Compute/store `token_expires_at` from `expires_in`
   - Set/refresh `connected_at` and `last_refreshed_at`

5. Finalize callback flow:
   - Delete used `oauth_state` row
   - Return redirect target for UI success/failure handling

## How to Test

- Complete real callback flow from Notion and confirm token row in `oauth_credentials`
- Replay callback with same state and confirm rejection
- Simulate invalid code and confirm clear token-exchange error
- Confirm successful callback marks server as connected in `/api/servers`

## Acceptance Criteria

- [x] Callback enforces state validation and expiry checks
- [x] Token exchange request/response handling is standards-compliant
- [x] Credentials are persisted with metadata needed for refresh/discovery reuse
- [x] Used/expired OAuth state entries are removed
