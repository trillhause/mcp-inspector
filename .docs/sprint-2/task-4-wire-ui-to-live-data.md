# Task 4: Wire UI to Live API Data

**Sprint:** 2 - Database, API & Live Data
**Status:** not_started
**Depends on:** Task 3

## Description

Replace hardcoded server rendering with real API-backed data flow so refreshes and state changes reflect persisted SQLite data.

## Steps

1. Add API data fetching in the page/server list flow:
   - Load from `GET /api/servers`
   - Replace direct usage of `PRECONFIGURED_SERVERS` in rendering path

2. Add loading and error states:
   - Loading skeleton or placeholder cards
   - Error banner/retry action for fetch failures

3. Preserve existing selection/inspector interactions:
   - Card selection still opens inspector
   - Selection resets safely if selected server no longer exists

4. Split list rendering by server type:
   - "Pre-configured Servers" section
   - "Custom Servers" section (empty state if none)

5. Keep TypeScript types aligned between API and UI (`McpServer`)

## How to Test

- Refresh page and confirm network request to `GET /api/servers`
- Confirm cards are rendered from API response data
- Confirm inspector selection still works as in Sprint 1
- Confirm UI handles API error state without crashing

## Acceptance Criteria

- [ ] Hardcoded list is no longer the runtime source for page rendering
- [ ] UI fetches server data from `/api/servers`
- [ ] Loading, success, and error states are implemented
- [ ] Pre-configured and custom servers are visually separated
- [ ] Existing inspector interactions remain functional
