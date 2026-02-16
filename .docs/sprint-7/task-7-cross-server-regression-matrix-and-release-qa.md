# Task 7: Cross-Server Regression Matrix + Release QA

**Sprint:** 7 - Polish & Multi-Server Testing
**Status:** done
**Depends on:** Task 5, Task 6

## Description

Run an end-to-end regression matrix across multiple OAuth-enabled MCP servers to validate universal-client behavior and release readiness.

## Steps

1. Define provider matrix:
   - Include Notion plus at least two additional OAuth-enabled providers (for example GitHub and Sentry)
   - Include expected transport/auth behavior notes per provider

2. Run core regression scenarios per provider:
   - Connect/disconnect/reconnect flows
   - Capability discovery + refresh
   - Tool execution and resource reading
   - Execution history visibility and drilldown
   - Server settings updates and guardrail behavior

3. Validate lifecycle edge cases:
   - Token warning and expired/reconnect-required paths
   - Network/transient failure recovery and retry behavior
   - Server switching while requests are in flight

4. Document outcomes:
   - Capture pass/fail per scenario and provider
   - Record provider-specific caveats with actionable remediation notes

5. Final release gates:
   - Accessibility smoke checks for keyboard navigation and focus continuity
   - Responsive checks across desktop/mobile layout states
   - `bun run build` passes

## How to Test

- Execute the full matrix and confirm each provider has deterministic outcomes for all core scenarios
- Confirm failures include actionable messages (not generic errors) and are documented
- Confirm build and baseline UX checks pass after all Sprint 7 changes

## Deliverables

- Regression runner: `scripts/qa/sprint7-regression-matrix.ts`
- Matrix outputs:
  - `.docs/sprint-7/regression-matrix-results.json`
  - `.docs/sprint-7/regression-matrix-summary.md`
- QA report: `.docs/sprint-7/task-7-release-qa-report.md`

## Acceptance Criteria

- [x] Regression matrix is completed across multiple OAuth-enabled MCP providers
- [x] Universal-client behavior is validated for connect, execute/read, history, and settings workflows
- [x] Build and core UX quality gates pass with documented caveats/remediations
