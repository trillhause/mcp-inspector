# Task 4: Dynamic Tool Parameter Form + Execute UX

**Sprint:** 6 - Tool Execution & Resource Reading
**Status:** done
**Depends on:** Task 2

## Description

Build a schema-driven form UI for MCP tool execution so users can run tools without hardcoded provider-specific forms.

## Steps

1. Build schema-to-form mapper:
   - Support common JSON Schema primitives (`string`, `number`, `integer`, `boolean`, `object`, `array`)
   - Support required-field indicators and sensible defaults

2. Create tool execution panel components:
   - Tool selector/details view
   - Dynamic parameter form area
   - Execute action with disabled/loading states

3. Add client-side validation UX:
   - Inline field-level validation hints
   - Submit-time summary for schema violations

4. Integrate execute route:
   - Call `POST /api/mcp/[serverId]/tools/[toolName]/execute`
   - Handle run lifecycle states and retry affordance

5. Preserve responsive + keyboard behavior:
   - Form controls are keyboard navigable
   - Layout remains usable on desktop and mobile widths

## How to Test

- Select multiple tools with different schemas and confirm form shape updates correctly
- Execute valid and invalid submissions and verify feedback clarity
- Switch servers/tools rapidly and confirm stale form state does not leak
- Verify keyboard-only execution flow works end-to-end

## Acceptance Criteria

- [x] Dynamic forms render from tool schemas without hardcoded per-tool forms
- [x] Execute UX handles validation, loading, success, and error states cleanly
- [x] Form behavior remains stable when switching servers or tools
- [x] Accessibility baseline is preserved for keyboard interactions
