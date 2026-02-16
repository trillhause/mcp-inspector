# Task 4: Token Expiry Warning + Reconnect Hardening

**Sprint:** 7 - Polish & Multi-Server Testing
**Status:** done
**Depends on:** Task 1

## Description

Harden auth lifecycle UX by proactively warning users about expiring tokens and providing deterministic reconnect behavior when refresh cannot recover.

## Steps

1. Implement token status derivation:
   - Derive `healthy`, `expiring_soon`, `expired`, `unknown` from credential timestamps
   - Keep logic centralized for consistent use across views

2. Add proactive warning UI:
   - Show non-blocking warning banner for expiring credentials
   - Include clear CTA (`Reconnect now` or `Refresh token`) based on supported flow

3. Harden expired-token behavior:
   - Ensure auth-required actions fail with deterministic reconnect-required state
   - Prevent repeated failing retries without user intervention

4. Integrate with existing refresh lifecycle:
   - Preserve current refresh-on-demand behavior where valid
   - Transition cleanly to reconnect-required when refresh is terminally unavailable

5. Validate multi-server edge cases:
   - Warning/expired state must remain server-scoped
   - Switching servers must not leak token warning state across selections

## How to Test

- Use credentials near expiry and confirm warning appears before failures
- Force refresh failure path and confirm reconnect-required state is shown with clear next action
- Confirm unaffected servers continue operating normally when one server expires

## Acceptance Criteria

- [x] Token-expiry warnings are proactive, visible, and actionable
- [x] Expired-token paths reliably transition to reconnect-required UX
- [x] Token lifecycle behavior is stable when multiple servers are connected
