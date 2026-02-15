# Task 4: Main Details Panel (Inspector Migration)

**Sprint:** 5 - UI Navigation Refresh (Sidebar + Main Panel)
**Status:** done
**Depends on:** Task 2

## Description

Migrate selected-server content from the bottom inspector component into a dedicated main details panel while preserving capability loading, refresh, and error-handling behavior.

## Steps

1. Extract selected-server content:
   - Server header metadata (name, icon, status)
   - Primary actions (connect/disconnect/reconnect)

2. Preserve capabilities workspace:
   - Tools/Resources/Prompts tabs
   - Counts, loading states, empty states, and error states

3. Preserve resilience UX:
   - Stale cache warnings
   - Manual refresh feedback
   - Retry actions

4. Remove dependence on panel expand/collapse state:
   - No bottom-fixed drawer interactions on desktop

5. Keep capability count propagation:
   - Continue updating server summary counts based on loaded capabilities

## How to Test

- Select connected server and verify capability tabs load exactly as before
- Trigger refresh and stale/error scenarios to verify warnings and retry behavior
- Select disconnected server and verify clear guidance state is shown

## Acceptance Criteria

- [ ] Main details panel fully replaces inspector content usage
- [ ] Capability loading/refresh/resilience behavior is unchanged functionally
- [ ] No regressions in tab counts or server capability summary updates
