# Task 6: Accessibility, Keyboard UX, and Regression QA

**Sprint:** 5 - UI Navigation Refresh (Sidebar + Main Panel)
**Status:** done
**Depends on:** Task 5

## Description

Run focused regression and accessibility validation to ensure the UI migration does not break existing connect/discovery/resilience workflows.

## Steps

1. Keyboard navigation validation:
   - Server list selection via keyboard
   - Focus visibility in sidebar and main panel
   - `Escape` handling in mobile slide-over

2. Interaction regression checks:
   - Connect/disconnect/reconnect behavior
   - OAuth callback selection restoration
   - Delete custom server flow

3. Capability workflow regression:
   - Tab rendering and counts
   - Refresh and stale-cache warnings
   - Error + retry states

4. Responsive regression checks:
   - Desktop, tablet, and mobile layouts
   - No overlap/clipping in common viewport sizes

5. Build verification:
   - Typecheck and production build success

## How to Test

- Execute manual checklist across desktop and mobile viewport sizes
- Validate key connect/discovery flows with at least one connected provider
- Run `bun run build` and confirm no new compile issues

## Acceptance Criteria

- [ ] Keyboard and focus behavior meet expected accessibility baseline
- [ ] UI migration introduces no connect/discovery/resilience regressions
- [ ] Responsive behavior is stable across target breakpoints
- [ ] Build passes after all UI migration changes
