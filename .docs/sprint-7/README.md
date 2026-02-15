# Sprint 7: Polish & Multi-Server Testing

**Goal:** Add production-ready polish across loading/error/token states, introduce dedicated execution history and server settings views, and validate behavior across multiple OAuth-enabled MCP servers.

**Status:** not_started

---

## How to Test This Sprint

Open `localhost:3000` and verify:
1. Connect at least two OAuth-enabled MCP servers (for example Notion + GitHub or Sentry)
2. Switch between connected servers and confirm loading skeletons/transition states render consistently in the main panel
3. Trigger capability/tool/resource fetches and confirm loading, success, empty, and stale states are visually distinct and non-blocking
4. Trigger representative failures (network/auth/validation/execution) and confirm error messages include clear remediation actions
5. Simulate near-expiry credentials and confirm a token-expiry warning is surfaced before hard failure
6. Trigger an expired/invalid token path and confirm reconnect-required UX appears with deterministic next steps
7. Open the execution history view and confirm recent runs render with status, timestamp, target, latency, and request/result summary access
8. Open server settings and confirm editable fields persist via API and reflect immediately in the UI
9. Run the cross-server regression matrix and confirm transport/auth differences are handled with stable UX
10. `bun run build` succeeds

---

## Task Dependency Graph

```
Task 1 (Polish Interaction Contract + State Taxonomy) → Task 2 (Loading States + Skeleton UX)
Task 1 → Task 3 (Actionable Error Handling + Recovery UX)
Task 1 → Task 4 (Token Expiry Warning + Reconnect Hardening)
Task 2 + Task 3 + Task 4 → Task 5 (Execution History View + Run Drilldown)
Task 1 → Task 6 (Server Settings Panel + Update Workflows)
Task 5 + Task 6 → Task 7 (Cross-Server Regression Matrix + Release QA)
```

## Tasks

| # | Task | File | Status | Depends On |
|---|------|------|--------|------------|
| 1 | Polish Interaction Contract + State Taxonomy | [task-1](task-1-polish-interaction-contract-and-state-taxonomy.md) | not_started | — |
| 2 | Loading States + Skeleton UX | [task-2](task-2-loading-states-skeletons-and-transition-feedback.md) | not_started | Task 1 |
| 3 | Actionable Error Handling + Recovery UX | [task-3](task-3-actionable-error-handling-and-recovery-ux.md) | not_started | Task 1 |
| 4 | Token Expiry Warning + Reconnect Hardening | [task-4](task-4-token-expiry-warning-and-reauth-flow-hardening.md) | not_started | Task 1 |
| 5 | Execution History View + Run Detail Drilldown | [task-5](task-5-execution-history-tab-and-run-detail-drilldown.md) | not_started | Task 2, Task 3, Task 4 |
| 6 | Server Settings Panel + Update Workflows | [task-6](task-6-server-settings-panel-and-update-workflows.md) | not_started | Task 1 |
| 7 | Cross-Server Regression Matrix + Release QA | [task-7](task-7-cross-server-regression-matrix-and-release-qa.md) | not_started | Task 5, Task 6 |

## Definition of Done

- Loading, empty, stale, and error states are consistent across server, capabilities, execution, and history surfaces
- Token lifecycle UX provides proactive expiry warnings and deterministic reconnect-required remediation
- Execution history is discoverable, readable, and useful for debugging across server contexts
- Server settings are editable through stable API workflows with validation and guardrails
- At least two non-Notion OAuth-enabled MCP providers are validated in a regression matrix
- Provider-specific differences are surfaced as actionable messages, not generic failures
- `bun run build` succeeds without TypeScript errors
