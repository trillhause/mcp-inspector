# Task 5: Resource Viewer + JSON Result Rendering

**Sprint:** 6 - Tool Execution & Resource Reading
**Status:** not_started
**Depends on:** Task 3

## Description

Create result presentation components for tool outputs and resource content with readable formatting, syntax highlighting, and clear fallback states.

## Steps

1. Implement JSON result renderer:
   - Syntax-highlighted JSON block for structured payloads
   - Safe fallback for non-JSON tool outputs

2. Implement resource content viewer:
   - Text/markdown rendering path
   - JSON rendering path
   - Unknown/binary fallback message with metadata

3. Add result metadata display:
   - Timestamp, duration, server name, target tool/resource
   - Error detail area with copy-friendly diagnostics

4. Add utility actions:
   - Copy response payload
   - Re-run last tool execution with same params (where appropriate)

5. Keep layout resilient:
   - Avoid overflow/collapse on large payloads
   - Maintain usable spacing and scrolling behavior in main panel

## How to Test

- Execute a tool returning structured JSON and confirm syntax highlighting renders correctly
- Load text and JSON resources and confirm viewer selects appropriate render path
- Trigger execution/read errors and confirm diagnostics render clearly
- Test large payload rendering and confirm UI remains responsive

## Acceptance Criteria

- [ ] Tool and resource results are displayed in readable, content-aware components
- [ ] JSON syntax highlighting is implemented and stable
- [ ] Error diagnostics and metadata are visible and actionable
- [ ] Large payload rendering does not break the layout
