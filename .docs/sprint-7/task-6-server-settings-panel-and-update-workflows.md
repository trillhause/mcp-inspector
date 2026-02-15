# Task 6: Server Settings Panel + Update Workflows

**Sprint:** 7 - Polish & Multi-Server Testing
**Status:** done
**Depends on:** Task 1

## Description

Add a server settings experience for editing supported server configuration fields with validation, guardrails, and immediate UI consistency.

## Steps

1. Define editable settings scope:
   - Display name/description (where allowed)
   - Transport mode (`auto`, `streamable_http`, `sse`)
   - Enabled state for local server availability

2. Build settings UI panel:
   - Form layout with field descriptions and validation hints
   - Save/cancel actions with unsaved-change handling

3. Integrate API updates:
   - Use `PATCH /api/servers/[id]` for persisted changes
   - Normalize request/response handling for deterministic feedback

4. Add provider guardrails:
   - Prevent unsupported edits for pre-configured servers
   - Show clear explanation when a field is read-only

5. Keep list/detail consistency:
   - Sidebar and selected-server header update immediately after save
   - Prevent state drift between list data and detail panel

## How to Test

- Update an editable custom-server field and confirm value persists after reload
- Change transport mode and confirm subsequent MCP actions use the new preference
- Attempt restricted edits on pre-configured servers and confirm read-only guardrails/messages
- Trigger invalid input and confirm inline validation + save prevention work

## Acceptance Criteria

- [x] Server settings UI exists with validated edit/save workflow
- [x] Allowed settings persist through stable API updates
- [x] Guardrails prevent unsupported provider/preconfigured edits cleanly
