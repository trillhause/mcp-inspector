# Task 3: Actionable Error Handling + Recovery UX

**Sprint:** 7 - Polish & Multi-Server Testing
**Status:** not_started
**Depends on:** Task 1

## Description

Standardize error rendering and remediation across MCP actions so failures are understandable and users can recover without guessing.

## Steps

1. Normalize error envelope usage in UI:
   - Consume deterministic `error.code`, category, message, and details
   - Ensure unknown errors map to a safe fallback with diagnostics

2. Implement recovery-oriented error components:
   - Inline errors for local form/settings validation
   - Section banners for fetch/action failures with retry/reconnect actions
   - Detail area for copy-friendly diagnostics

3. Add category-specific remediation mapping:
   - Auth failures -> reconnect flow
   - Validation failures -> field-level guidance
   - Not-found failures -> refresh capabilities
   - Connection/execution failures -> retry/check endpoint action

4. Prevent silent failures:
   - Ensure request failures update visible UI state
   - Ensure all failed actions return deterministic user-facing feedback

5. Validate copy and consistency:
   - Use concise, user-actionable language across all surfaces

## How to Test

- Trigger representative `validation`, `auth`, and `connection` errors and verify mapped remediation actions
- Confirm retry/reconnect controls are present where expected and route to the correct workflow
- Confirm unexpected server errors still render a stable fallback message with diagnostics

## Acceptance Criteria

- [ ] Error states are mapped to deterministic, actionable remediation UX
- [ ] Failure handling is consistent across capabilities, execution, history, and settings views
- [ ] Users can recover from common failures without refreshing the whole app
