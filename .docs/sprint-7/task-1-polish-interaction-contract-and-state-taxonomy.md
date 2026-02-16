# Task 1: Polish Interaction Contract + State Taxonomy

**Sprint:** 7 - Polish & Multi-Server Testing
**Status:** not_started
**Depends on:** none

## Description

Define a shared interaction contract for loading, error, token, history, and settings behavior so Sprint 7 implementation stays consistent across server providers.

## Steps

1. Author Sprint 7 contract doc:
   - Create `.docs/sprint-7/interaction-contract.md`
   - Define canonical state names and transitions used by UI and API callers

2. Define loading and stale-data behavior:
   - Specify skeleton usage rules and refresh behavior
   - Specify when stale cached data remains visible during refetch

3. Define error taxonomy to UX mapping:
   - Map deterministic error codes to user-facing remediation actions
   - Prevent generic unrecoverable messaging where actionable next steps exist

4. Define token lifecycle contract:
   - `healthy`, `expiring_soon`, `expired`, `unknown`
   - Warning and reconnect-required behavior expectations

5. Define explicit scope boundaries:
   - In-scope: polish, consistency, multi-server regression
   - Out-of-scope: provider-specific one-off custom logic

## How to Test

- Review contract and confirm all Sprint 7 tasks reference the same state/error naming
- Confirm route/UI implementers can use the contract without ambiguity

## Acceptance Criteria

- [ ] Contract document exists and is implementation-ready
- [ ] Shared state taxonomy is explicit and reusable across all Sprint 7 surfaces
- [ ] Error and token lifecycle behavior is defined with actionable UX mapping
