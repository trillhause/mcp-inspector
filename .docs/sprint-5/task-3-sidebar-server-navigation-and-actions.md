# Task 3: Sidebar Server Navigation + Actions

**Sprint:** 5 - UI Navigation Refresh (Sidebar + Main Panel)
**Status:** not_started
**Depends on:** Task 2

## Description

Implement a compact, grouped server navigation sidebar that supports selection and quick actions while replacing card-based browsing.

## Steps

1. Build grouped server sections:
   - `Pre-configured`
   - `Custom`

2. Add sidebar search/filter:
   - Filter by name, description, and MCP URL
   - Keep client-side filtering only

3. Create reusable server row component:
   - Icon, name, status badge, optional capability count hints
   - Selected row visual state

4. Add quick row actions:
   - Connect / Reconnect / Disconnect
   - Delete for custom servers only

5. Keep action conflict guards:
   - Respect existing in-flight connect/disconnect/delete loading guards

## How to Test

- Confirm rows render in grouped order and reflect live server states
- Confirm quick actions trigger existing flows and update UI status
- Confirm deleting selected custom server removes it and handles selection fallback
- Confirm search filters both sections consistently

## Acceptance Criteria

- [ ] Sidebar navigation replaces server-card browsing for selection
- [ ] Grouping, selection, and quick actions are reliable
- [ ] Existing async action protections are preserved
