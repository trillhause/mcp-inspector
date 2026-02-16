# Task 6: UI Connect/Disconnect + OAuth Callback UX

**Sprint:** 3 - OAuth Connect Flow (End-to-End)
**Status:** not_started
**Depends on:** Task 4, Task 5

## Description

Wire frontend interactions to OAuth backend routes so users can connect/disconnect servers and see clear progress and outcomes.

## Steps

1. Enable card/inspector connect actions:
   - Replace disabled `Connect` button in `components/server-card.tsx`
   - Add connect/reconnect action in `components/inspector-panel.tsx`

2. Implement connect UI flow:
   - Call `POST /api/servers/[id]/connect`
   - Show loading state and redirect browser to returned `authorization_url`

3. Implement callback landing UX:
   - Add callback page/handler state reconciliation (success + error)
   - Show user-visible error messaging for OAuth failures
   - Reload/reconcile server list after callback completion

4. Implement disconnect UI flow:
   - Add `Disconnect` action for connected servers
   - Call `POST /api/servers/[id]/disconnect`
   - Optimistically update card/inspector status with rollback on error

5. Add manual E2E checklist notes for Notion:
   - Consent success path
   - Reconnect path for expired state
   - Disconnect path returning to Not Connected

## How to Test

- Click `Connect` on Notion and complete OAuth; return to app as connected
- Verify loading + disabled states prevent duplicate submits during redirect prep
- Trigger callback error and confirm actionable UI error
- Click `Disconnect` and confirm status/badge updates immediately

## Acceptance Criteria

- [ ] Connect button initiates real OAuth flow
- [ ] Callback outcomes are surfaced clearly in UI
- [ ] Disconnect action clears connection state end-to-end
- [ ] Notion connect/disconnect can be repeatedly tested without stale state bugs
