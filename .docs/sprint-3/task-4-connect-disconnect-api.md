# Task 4: Server Connect/Disconnect API Routes

**Sprint:** 3 - OAuth Connect Flow (End-to-End)
**Status:** done
**Depends on:** Task 3

## Description

Expose server-level connect/disconnect endpoints so the UI can trigger OAuth start and clear credentials cleanly.

## Steps

1. Implement connect route:
   - `POST /api/servers/[id]/connect`
   - Resolve server, run discovery/authorize pipeline, return `authorization_url`

2. Implement disconnect route:
   - `POST /api/servers/[id]/disconnect`
   - Remove `oauth_credentials` row for server
   - Optionally call revocation endpoint when metadata supports it

3. Normalize route responses:
   - Success payloads include server id and next action (`redirect`, `disconnected`)
   - Failure payloads reuse OAuth error shape with machine-readable code

4. Update server projection behavior:
   - Ensure `/api/servers` and `/api/servers/[id]` reflect `disconnected`/`connected`/`expired`
   - Preserve compatibility with existing `McpServer` frontend type

## How to Test

- `POST /api/servers/:id/connect` returns OAuth authorization URL
- `POST /api/servers/:id/disconnect` clears stored credentials
- `/api/servers` reflects status transitions after connect/disconnect
- Unsupported connect attempts return actionable errors

## Acceptance Criteria

- [x] Connect route is wired to OAuth authorize flow
- [x] Disconnect route removes credentials and resets status
- [x] Server status mapping is correct after state changes
- [x] API responses are consistent with frontend expectations
