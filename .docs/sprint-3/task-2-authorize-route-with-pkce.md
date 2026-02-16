# Task 2: PKCE + Authorize Route

**Sprint:** 3 - OAuth Connect Flow (End-to-End)
**Status:** not_started
**Depends on:** Task 1

## Description

Create the authorization initiation path: generate PKCE values, persist short-lived OAuth state, and return the authorization URL for browser redirect.

## Steps

1. Add PKCE helpers:
   - `lib/oauth/pkce.ts`
   - `generateCodeVerifier()` and `generateCodeChallengeS256()`
   - `generateState()` for CSRF protection

2. Implement OAuth state persistence:
   - Insert `state_value`, `code_verifier`, `redirect_uri`, `expires_at`, and `mcp_server_id` into `oauth_state`
   - Add state TTL policy (10 minutes)
   - Add cleanup helper for expired state rows

3. Implement dynamic client registration decision:
   - If metadata has `registration_endpoint`, register client and persist `client_id` (+ optional `client_secret`)
   - If no registration endpoint, use server-specific preconfigured client strategy (where applicable)

4. Add authorize route:
   - `POST /api/oauth/authorize`
   - Input: `mcp_server_id` and optional `redirect_uri`
   - Output: `authorization_url` + lightweight flow metadata

5. Build authorization URL correctly:
   - Include `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`
   - Optional scopes/prompt only when needed by provider

## How to Test

- Call `POST /api/oauth/authorize` and confirm it returns a valid auth URL
- Confirm a row is written to `oauth_state` with short expiry
- Confirm state cleanup removes expired rows
- Confirm registration behavior works both with and without `registration_endpoint`

## Acceptance Criteria

- [ ] PKCE values are generated and encoded correctly for S256
- [ ] OAuth state is stored with expiry and linked to target server
- [ ] Authorize route returns a redirectable authorization URL
- [ ] Dynamic registration is supported when available
