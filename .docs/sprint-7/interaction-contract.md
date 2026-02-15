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

## 7. Non-Goals for Sprint 7

- No net-new OAuth discovery standards work beyond existing implementation (Sprint 8 scope)
- No provider-specific custom form/rendering logic for individual tools
- No mutation workflows for external resources
- No background job queueing or scheduled execution
