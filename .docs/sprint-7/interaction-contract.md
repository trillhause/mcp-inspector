# Sprint 7 — Polish, Error, and Multi-Server UX Contract

This document defines the interaction contract for Sprint 7 and is the source of truth for Tasks 2–7.

---

## 1. Shared UI State Taxonomy

All primary surfaces must use the same top-level lifecycle states:

- `idle`: no request active and no cached data rendered yet
- `loading`: request in flight, show skeleton/progress affordances
- `success`: valid data rendered
- `empty`: valid request with no items to render
- `stale`: cached data shown while refresh is in flight or failed recoverably
- `error`: request failed and requires user action or retry

State naming and transitions must be deterministic across:
- capabilities view
- tool execution/result view
- resource viewer
- execution history
- server settings

Canonical transitions:

| From | Allowed To |
|------|------------|
| `idle` | `loading`, `success`, `empty`, `error` |
| `loading` | `success`, `empty`, `stale`, `error` |
| `success` | `loading`, `stale`, `empty`, `error` |
| `empty` | `loading`, `success`, `error` |
| `stale` | `loading`, `success`, `empty`, `error` |
| `error` | `loading`, `stale`, `success`, `empty` |

---

## 2. Loading + Transition Contract

- Avoid blank panels during fetches; render skeleton rows/placeholders per section
- Keep previous successful data visible while refreshing when safe (`stale` state)
- Disable only the in-flight action, not unrelated controls
- Use explicit labels for long-running actions (`Executing`, `Reading`, `Saving settings`)
- Ensure keyboard focus remains stable during async state transitions

---

## 3. Error Contract and Remediation Mapping

Errors must include:

- machine-readable code
- human-readable message
- action-oriented remediation hint

Canonical UX groupings:

| Category | Typical Codes | Primary Action |
|----------|----------------|----------------|
| `auth` | `AUTH_REQUIRED`, `RECONNECT_REQUIRED` | Reconnect |
| `connection` | `MCP_CONNECT_FAILED`, `NETWORK_ERROR` | Retry / Check endpoint |
| `validation` | `INVALID_REQUEST`, `VALIDATION_ERROR` | Fix input |
| `execution` | `EXECUTION_FAILED`, `READ_FAILED` | Retry / View details |
| `not_found` | `TOOL_NOT_FOUND`, `RESOURCE_NOT_FOUND` | Refresh capabilities |
| `internal` | `INTERNAL_ERROR` | Retry / Report issue |

Generic failures must not be shown without a next-step action.

Deterministic code-to-remediation mapping:

| Code | Category | Primary CTA | UX Hint |
|------|----------|-------------|---------|
| `INVALID_REQUEST` | `validation` | `Fix request` | Review request format and submit again |
| `VALIDATION_ERROR` | `validation` | `Fix input` | Correct invalid fields before retrying |
| `NETWORK_ERROR` | `connection` | `Retry` | Check network and endpoint availability |
| `NOT_CONNECTED` | `connection` | `Connect` | Connect this server before running MCP actions |
| `AUTH_REQUIRED` | `auth` | `Reconnect` | Authentication is required to continue |
| `RECONNECT_REQUIRED` | `auth` | `Reconnect` | Credentials are no longer recoverable with refresh |
| `TOOL_NOT_FOUND` | `not_found` | `Refresh capabilities` | Tool list may be stale |
| `RESOURCE_NOT_FOUND` | `not_found` | `Refresh capabilities` | Resource list may be stale |
| `MCP_CONNECT_FAILED` | `connection` | `Retry` | Verify transport and endpoint reachability |
| `EXECUTION_FAILED` | `execution` | `Retry` | Retry or inspect diagnostics |
| `READ_FAILED` | `execution` | `Retry` | Retry or inspect diagnostics |
| `INTERNAL_ERROR` | `internal` | `Retry` | Report issue with diagnostics if persistent |

---

## 4. Token Lifecycle UX Contract

Per connected server, derived token states:

- `healthy`: expires later than warning threshold
- `expiring_soon`: within warning window (for example <= 15 minutes)
- `expired`: token expiry passed
- `unknown`: token expiry unavailable

Behavior:

- Show non-blocking warning banner for `expiring_soon`
- For `expired`, block auth-required actions with reconnect-required CTA
- If refresh succeeds, clear warning state without full-page disruption
- If refresh fails terminally, transition to reconnect-required state with reason context

Derivation rules:

- `warning_threshold_ms`: `900000` (15 minutes) unless a future config override is introduced
- missing/invalid `token_expires_at`: `unknown`
- `token_expires_at <= now`: `expired`
- `0 < token_expires_at - now <= warning_threshold_ms`: `expiring_soon`
- `token_expires_at - now > warning_threshold_ms`: `healthy`

---

## 5. Execution History Contract

- History entry minimum fields: `server`, `type`, `name`, `status`, `executed_at`, `duration_ms`
- History defaults to reverse-chronological order
- History detail view must expose parameter summary and result/error summary
- Filtering must support at least `type` and `status`
- History remains scoped to selected server unless a deliberate cross-server view is added

---

## 6. Server Settings Contract

Settings scope for Sprint 7:

- editable fields: server display name/description (where applicable), transport mode, enabled state
- non-editable fields: immutable server identity and provider-owned metadata
- pre-configured server guardrails must prevent destructive edits outside allowed fields

Settings update behavior:

- optimistic disabled submit while save is in flight
- inline validation errors for invalid input
- success/failure toast/banner feedback

---

## 7. Scope Boundaries

In scope:

- state and copy consistency across surfaces
- deterministic remediation UX for known error codes
- token lifecycle warning and reconnect state semantics
- contract-level rules needed by Sprint 7 implementation tasks

Out of scope:

- No net-new OAuth discovery standards work beyond existing implementation (Sprint 8 scope)
- No provider-specific custom form/rendering logic for individual tools
- No mutation workflows for external resources
- No background job queueing or scheduled execution

---

## 8. Runtime Contract Anchors

This document is mirrored by shared runtime constants/types in:

- `lib/mcp/interaction-contract.ts`
