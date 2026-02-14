# Task 2: Desktop Two-Pane Shell Layout

**Sprint:** 5 - UI Navigation Refresh (Sidebar + Main Panel)
**Status:** not_started
**Depends on:** Task 1

## Description

Restructure the app shell from card-grid + bottom inspector into a desktop two-pane layout with persistent navigation context.

## Steps

1. Create two-pane page shell:
   - Sidebar column for server navigation
   - Main panel column for selected server details

2. Update spacing/container behavior:
   - Remove bottom inspector reserved space from page padding
   - Keep top header and global notice banners

3. Preserve existing state ownership:
   - Keep server list, selected server, and async action states in page-level container

4. Maintain responsive breakpoints:
   - Sidebar persistent on desktop
   - Mobile behavior delegated to Task 5

5. Ensure empty selection state:
   - Main panel shows guidance when no server is selected

## How to Test

- Run app on desktop widths and confirm sidebar + main panel are always visible
- Verify selecting a server updates main content without opening a drawer
- Verify OAuth and error banners still render correctly in new shell

## Acceptance Criteria

- [ ] Desktop shell is two-pane and stable across common viewport sizes
- [ ] Existing page-level state behavior is preserved
- [ ] Empty selection behavior is clear and usable
