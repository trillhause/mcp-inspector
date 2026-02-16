# Task 5: Token Refresh + Credential Lifecycle Hardening

**Sprint:** 3 - OAuth Connect Flow (End-to-End)
**Status:** not_started
**Depends on:** Task 3

## Description

Implement refresh behavior and lifecycle handling so connected servers remain usable and safely recover when tokens are invalid.

## Steps

1. Add refresh service:
   - `lib/oauth/refresh.ts`
   - Refresh by `refresh_token` using discovered `token_endpoint`
   - Persist rotated `refresh_token` atomically when returned

2. Add lifecycle policy helpers:
   - Expiry checks with pre-expiry buffer (5-10 minutes)
   - Mark credentials expired when refresh cannot recover
   - Map `invalid_grant` to re-auth-required state

3. Prevent concurrent refresh races:
   - Add per-server single-flight/mutex strategy in process
   - Ensure one refresh write wins and consumers reuse result

4. Add refresh API route:
   - `POST /api/oauth/refresh`
   - Input by `mcp_server_id`
   - Output updated token metadata/status

5. Add observability-safe logs:
   - Log refresh event outcomes without logging tokens/secrets

## How to Test

- Force near-expiry token and confirm refresh succeeds
- Confirm rotated refresh token is persisted when provided
- Simulate `invalid_grant` and confirm status becomes reconnect-required
- Run concurrent refresh requests and confirm only one successful token write

## Acceptance Criteria

- [ ] Refresh flow updates stored credentials safely
- [ ] Refresh-token rotation is handled correctly
- [ ] `invalid_grant` triggers reconnect path instead of repeated retries
- [ ] No sensitive token values are logged
