# Task 6: Execution History + Cross-Server Regression QA

**Sprint:** 6 - Tool Execution & Resource Reading
**Status:** not_started
**Depends on:** Task 4, Task 5

## Description

Persist execution/read activity and validate the complete Sprint 6 workflow across multiple OAuth-enabled MCP providers.

## Steps

1. Add execution history persistence:
   - Extend schema/store for tool runs and resource reads
   - Capture server, action type, target, params summary, status, duration, created timestamp

2. Create history retrieval path:
   - API endpoint or integrated payload for recent activity per server
   - Stable pagination/limit behavior

3. Add history UI section:
   - Recent runs list with status and timestamp
   - Click row to inspect stored request/response summary

4. Run cross-server regression matrix:
   - Validate Notion plus at least one additional OAuth-enabled MCP server
   - Validate auth refresh, reconnect-required, and transport fallback scenarios

5. Final quality gates:
   - Keyboard + responsive checks for execution and history views
   - `bun run build` passes

## How to Test

- Execute tools and read resources, then confirm entries appear in history in reverse-chronological order
- Reload app and confirm history persists for the server
- Validate at least two providers with deterministic success/failure outcomes and actionable errors
- Run `bun run build` and confirm no compile issues

## Acceptance Criteria

- [ ] Execution/resource activity is persisted with sufficient debugging context
- [ ] History is visible and usable from the main UI
- [ ] Multi-provider regression checks are completed and documented
- [ ] Build and core UX checks pass after Sprint 6 scope is complete
