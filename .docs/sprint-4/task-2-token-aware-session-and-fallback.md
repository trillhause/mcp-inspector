# Task 2: Token-Aware MCP Session + Transport Fallback

**Sprint:** 4 - MCP Capabilities Discovery
**Status:** done
**Depends on:** Task 1

## Description

Make MCP session creation resilient by integrating token refresh behavior and automatic transport fallback (streamable HTTP first, then SSE when needed).

## Steps

1. Integrate credential lifecycle checks:
   - Reuse token expiry helpers from Sprint 3
   - Refresh token before MCP connect when within pre-expiry buffer

2. Handle unauthorized responses:
   - On MCP auth failure, attempt single refresh + retry path
   - If refresh fails with `invalid_grant`, surface reconnect-required status

3. Implement transport fallback:
   - For `auto`, try streamable HTTP first
   - Fallback to SSE if primary transport cannot establish session
   - Record transport actually used for diagnostics

4. Guard against concurrent refresh/session races:
   - Reuse single-flight behavior per server where possible
   - Ensure only one token refresh write wins

5. Add observability-safe diagnostics:
   - Log failure category and selected transport without sensitive values

## How to Test

- Simulate near-expiry token and confirm refresh occurs before MCP session starts
- Simulate unauthorized response and confirm one refresh + retry attempt is made
- Force streamable transport failure and confirm SSE fallback is attempted
- Validate reconnect-required response when refresh cannot recover credentials

## Acceptance Criteria

- [x] Session bootstrap uses refresh-aware credential flow
- [x] Unauthorized responses trigger controlled refresh + retry behavior
- [x] `auto` transport mode performs deterministic streamable -> SSE fallback
- [x] Refresh/session concurrency does not create duplicate token mutations
