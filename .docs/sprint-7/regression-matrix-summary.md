| Provider | Pass | Warn | Fail | Skip |
|---|---:|---:|---:|---:|
| notion | 11 | 0 | 0 | 0 |
| sentry | 11 | 0 | 0 | 0 |
| posthog | 11 | 0 | 0 | 0 |

| Edge Case Scenario | Status | Detail |
|---|---|---|
| cross-server-in-flight-capabilities | pass | Concurrent capabilities requests returned actionable outcomes across providers |
| token-expiry-refresh-reconnect-required | pass | Forced refresh transitioned to reconnect_required for expired credentials |
| token-expiry-capabilities-reconnect-state | pass | Capabilities path reflected reconnect-required token lifecycle state |
| accessibility-smoke-keyboard-and-labels | pass | Keyboard escape handling, filter aria-labels, and settings form labels are present in UI contracts |
| responsive-smoke-desktop-mobile-shell | pass | Desktop sidebar and mobile sheet toggles are both present in the shell layout |
