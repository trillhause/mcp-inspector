# Task 6: UI Connect/Disconnect + OAuth Callback UX

**Sprint:** 3 - OAuth Connect Flow (End-to-End)
**Status:** done
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

- [x] Connect button initiates real OAuth flow
- [x] Callback outcomes are surfaced clearly in UI
- [x] Disconnect action clears connection state end-to-end
- [x] Notion connect/disconnect can be repeatedly tested without stale state bugs

## Manual E2E Checklist Notes (Notion)

1. Consent success path:
   - Click `Connect` on Notion card (or inspector action)
   - Confirm button enters loading state and browser redirects to provider consent
   - Approve consent and confirm redirect back to app with success banner + connected status
2. Reconnect path for expired state:
   - Force token to expired/invalid state and confirm card badge shows `Reconnect`
   - Click `Reconnect` and complete OAuth again
   - Confirm status returns to `Connected`
3. Disconnect path:
   - Click `Disconnect` on connected server
   - Confirm optimistic UI transition and final server state becomes `Not Connected`
   - Confirm follow-up reconnect can be initiated without stale callback/query-state issues
