# Task 5: Mobile Slide-Over Server Picker

**Sprint:** 5 - UI Navigation Refresh (Sidebar + Main Panel)
**Status:** not_started
**Depends on:** Task 3, Task 4

## Description

Implement a mobile-first server picker that preserves the new navigation model without forcing a cramped always-visible sidebar.

## Steps

1. Add mobile trigger control:
   - `Servers` button in header or main panel toolbar

2. Implement slide-over panel:
   - Reuse server list rows/grouping/search from sidebar
   - Include close action and focus management

3. Hook selection behavior:
   - Selecting a server updates main panel content
   - Slide-over closes automatically after selection

4. Add dismissal patterns:
   - Explicit close button
   - `Escape` key support
   - Backdrop click support

5. Ensure state parity with desktop:
   - Same quick actions and loading states
   - Same server ordering and status indicators

## How to Test

- On mobile viewport, open slide-over and switch between multiple servers
- Verify selected server details update in main panel and sheet closes on selection
- Verify close/dismiss interactions are reliable

## Acceptance Criteria

- [ ] Mobile server navigation is provided via slide-over picker
- [ ] Selection and action behavior match desktop semantics
- [ ] Dismissal and focus management are accessible and predictable
