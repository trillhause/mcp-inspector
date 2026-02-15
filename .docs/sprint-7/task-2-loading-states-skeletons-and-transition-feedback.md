# Task 2: Loading States + Skeleton UX

**Sprint:** 7 - Polish & Multi-Server Testing
**Status:** done
**Depends on:** Task 1

## Description

Implement consistent loading and transition feedback so users can switch servers and run actions without abrupt blank states or unclear progress.

## Steps

1. Implement shared loading primitives:
   - Reusable skeleton rows/cards for server details, capabilities, history, and settings
   - Section-level loading wrappers with consistent spacing and animation

2. Apply transition-safe rendering:
   - Keep prior data visible during refresh where contract allows
   - Avoid full-panel content flashes when switching between loaded servers

3. Add action-level progress feedback:
   - Button states for execute/read/save/refresh actions
   - In-flight labels and disabled states only for active action targets

4. Handle empty and stale states distinctly:
   - Empty responses show contextual empty-state guidance
   - Stale cache state shows warning + refresh affordance

5. Validate responsive behavior:
   - Desktop sidebar/main panel and mobile sheet remain usable while loading

## How to Test

- Switch rapidly between two connected servers and confirm panel transitions remain stable
- Trigger capabilities refresh and confirm stale state shows previous data plus refresh indicator
- Confirm no major section renders as a blank block during normal fetch lifecycles

## Acceptance Criteria

- [x] Loading and transition patterns are consistent across major views
- [x] Skeleton, empty, stale, and success states are visually distinct and stable
- [x] Async action buttons show clear in-flight behavior without over-disabling unrelated controls
