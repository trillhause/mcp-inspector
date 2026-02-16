# Task 5: Add Custom Server Dialog

**Sprint:** 2 - Database, API & Live Data
**Status:** done
**Depends on:** Task 3, Task 4

## Description

Implement the "Add Server" dialog and connect it to the servers API so users can add custom MCP servers from the UI.

## Steps

1. Build dialog component:
   - `components/add-server-dialog.tsx` (or similar)
   - Use shadcn `Dialog`, form inputs, and validation messaging

2. Enable header action:
   - Update `components/header.tsx` so "Add Server" opens the dialog
   - Remove Sprint 1 disabled state

3. Form fields:
   - Required: `name`, `mcp_url`
   - Optional: `description`, `transport`
   - Client-side URL validation before submit
   - Help text: accept either MCP base URL (`https://mcp.notion.com`) or explicit endpoint (`https://mcp.notion.com/mcp`)
   - Show normalized URL preview so users know what will be stored

4. Submit flow:
   - `POST /api/servers`
   - Show pending state while saving
   - Close dialog and refresh/reconcile server list on success
   - Show inline error on failure

5. Add custom server deletion entry point in UI:
   - Add delete action (button/menu) for custom server cards
   - Call `DELETE /api/servers/[id]`
   - Update list and selection state after delete

## How to Test

- Click "Add Server" and verify dialog opens
- Submit invalid URL and confirm validation prevents submit
- Submit valid custom server and confirm it appears in Custom Servers section
- Submit `https://mcp.notion.com/mcp` and confirm stored/rendered URL is canonicalized consistently
- Refresh page and verify the custom server persists
- Delete the custom server and verify it disappears immediately

## Acceptance Criteria

- [x] "Add Server" button opens a working dialog
- [x] Valid custom servers can be created through API from UI
- [x] Validation errors are shown clearly for bad input
- [x] Custom servers appear and persist after refresh
- [x] Custom servers can be deleted from UI
