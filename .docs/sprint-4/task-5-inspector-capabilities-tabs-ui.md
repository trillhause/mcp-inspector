# Task 5: Inspector Tabs UI for Tools/Resources/Prompts

**Sprint:** 4 - MCP Capabilities Discovery
**Status:** done
**Depends on:** Task 4

## Description

Render discovered capabilities inside the inspector panel with dedicated tabs, counts, and robust loading/empty/error states.

## Steps

1. Extend inspector data loading:
   - Fetch `GET /api/mcp/[serverId]/capabilities` when a connected server is selected
   - Keep existing selection behavior from prior sprints

2. Build tabbed capability sections:
   - Tools tab: list name + description + schema presence indicator
   - Resources tab: list URI + name/description
   - Prompts tab: optional list when provided

3. Add UX states:
   - Skeleton/loading state while capabilities load
   - Empty states for zero tools/resources/prompts
   - Error state with retry action

4. Add lightweight counts/badges:
   - Show tools/resources/prompts counts on tabs and/or card summary

5. Keep component boundaries clean:
   - Extract reusable list row components for later Sprint 5 execution flows

## How to Test

- Select a connected server and confirm tabs populate with discovered items
- Confirm tab counts match route payload counts
- Select disconnected server and confirm capability tabs are hidden/disabled with clear guidance
- Simulate API error and confirm retry UX works

## Acceptance Criteria

- [x] Inspector displays Tools/Resources/Prompts tabs with live capability data
- [x] Loading, empty, and error states are implemented and usable
- [x] Capability counts are visible and consistent with API response
- [x] UI remains responsive when switching quickly between servers
