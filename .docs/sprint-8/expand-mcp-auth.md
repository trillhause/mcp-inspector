# Sprint 8 Plan: expand-mcp-auth

## Objective

Strengthen OAuth interoperability across preconfigured and custom MCP providers so connect flow outcomes are predictable, actionable, and resilient to provider-specific metadata patterns.

## Scope

- OAuth discovery and auth bootstrap behavior for MCP servers with non-uniform metadata exposure
- Provider-specific client requirements (dynamic registration vs preconfigured OAuth clients)
- Error classification and UX messaging for connection failures
- Validation and operational guidance to keep provider integrations reliable over time

## Findings (Detailed)

1. Discovery coverage is too narrow for real provider behavior.
   - Current flow is strongest when providers expose root protected-resource metadata.
   - Some providers expose metadata in path-scoped or alternate patterns, which the current flow may not discover.
   - Result: false-negative `unsupported` outcomes even when provider auth can work.

2. Provider auth models are heterogeneous.
   - Some providers support dynamic client registration.
   - Others require explicit client credentials and pre-registered app configuration.
   - Result: connection failures that are technically correct but operationally unclear to users.

3. Error output is accurate but not fully actionable.
   - API returns machine-readable failures, but remediation is inconsistent from the user perspective.
   - Similar top-level failures may require very different corrective actions.
   - Result: slower troubleshooting and repeated failed connect attempts.

4. Provider metadata assumptions drift over time.
   - Provider endpoints, auth metadata, and policy requirements can change.
   - Static assumptions in code/docs degrade reliability unless regularly verified.
   - Result: regressions introduced without local code changes.

5. Validation depth is insufficient at provider matrix level.
   - Existing validation focuses on successful provider examples.
   - Cross-provider negative-path and edge-case verification is limited.
   - Result: inconsistent behavior across preconfigured providers.

## Improvement Plan

### 1) Expand Discovery Strategy

- Implement ordered discovery attempts that account for root and path-aware metadata exposure.
- Incorporate standards-based fallback hints when direct metadata endpoints are unavailable.
- Normalize discovered metadata into one internal contract for downstream auth flow logic.
- Define deterministic stop conditions and error mapping for each discovery stage.

Expected outcome:
- Higher connect success rate for standards-compliant providers that differ in metadata location.
- Fewer false `unsupported server` responses.

### 2) Introduce Provider Capability Profiles

- Define capability metadata per provider (discovery expectations, registration support, client requirements, known constraints).
- Use profiles to drive preflight checks before initiating connect.
- Keep profiles declarative so behavior can be adjusted without scattered logic changes.

Expected outcome:
- Cleaner branching between dynamic registration and configured-client flows.
- Reduced provider-specific regressions.

### 3) Improve Configuration Readiness Checks

- Add explicit readiness validation for providers requiring local OAuth credentials.
- Surface missing requirements before expensive discovery/auth attempts.
- Distinguish between “provider unsupported” and “local configuration incomplete.”

Expected outcome:
- Faster setup and fewer confusing failures.
- Clear path for users to resolve credential-related issues.

### 4) Standardize Error Taxonomy and Remediation Mapping

- Map discovery, registration, token, and configuration failures to stable categories.
- Attach concise remediation guidance to each category for UI display and logs.
- Ensure responses remain machine-readable while improving human actionability.

Expected outcome:
- Faster issue triage and less ambiguity during connect failures.
- Better UX consistency across providers.

### 5) Add Provider Conformance and Regression Matrix

- Define a matrix covering all preconfigured providers and common custom-provider patterns.
- Include positive connect, expected unsupported, and expected missing-config scenarios.
- Validate both API semantics and UI-facing behavior for each scenario.

Expected outcome:
- Early detection of provider-specific regressions.
- Confidence that new auth improvements do not break known-good providers.

### 6) Improve Observability and Operational Documentation

- Add non-sensitive diagnostics around discovery path taken, failure category, and next action.
- Document provider onboarding/troubleshooting playbooks for operators and developers.
- Establish a periodic metadata verification routine for preconfigured providers.

Expected outcome:
- Quicker root-cause identification in production-like environments.
- Lower maintenance cost as provider ecosystems evolve.

## Success Criteria

- All preconfigured providers produce deterministic connect outcomes:
  - redirect-ready authorization URL, or
  - explicit actionable remediation with stable error classification.
- Discovery failures are explainable by logged stage and categorized reason.
- Providers requiring manual OAuth setup fail fast with clear preflight guidance.
- Regression matrix passes for both positive and negative-path expectations.

## Out of Scope (for this planning document)

- Task-level decomposition and scheduling
- Code-level implementation details
- UI redesign beyond error/actionability improvements needed for auth flow clarity
