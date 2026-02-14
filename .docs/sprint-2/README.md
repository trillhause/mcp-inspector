# Sprint 2: Database, API & Live Data

**Goal:** Set up SQLite with schema, seed pre-configured servers, create CRUD API routes, and wire the UI to fetch from real API instead of hardcoded data. Add the "Add Custom Server" dialog.

**Status:** in_progress

---

## How to Test This Sprint

Open `localhost:3000` and verify:
1. Network tab shows `GET /api/servers` on page load
2. The server cards render from API data (not hardcoded in the page component)
3. Click "Add Server" to open a dialog
4. Submit a valid custom server (name + MCP URL) and confirm it appears under a Custom Servers section
5. Refresh the page and confirm the custom server persists (data in SQLite)
6. Submit both `https://mcp.notion.com` and `https://mcp.notion.com/mcp` and confirm URL canonicalization avoids duplicate logical servers
7. Delete the custom server and confirm it disappears from UI and API responses
8. `bun run build` succeeds

---

## Task Dependency Graph

```
Task 1 (SQLite + Schema) → Task 2 (Seed Preconfigured Servers) → Task 3 (Servers CRUD API)
                                                           └──────→ Task 4 (UI Uses API)
Task 3 (Servers CRUD API) + Task 4 (UI Uses API) → Task 5 (Add Custom Server Dialog)
```

## Tasks

| # | Task | File | Status | Depends On |
|---|------|------|--------|------------|
| 1 | SQLite Setup & Schema | [task-1](task-1-database-setup.md) | done | — |
| 2 | Seed Preconfigured Servers | [task-2](task-2-seed-preconfigured-servers.md) | done | Task 1 |
| 3 | Servers CRUD API Routes | [task-3](task-3-servers-api-route.md) | done | Task 2 |
| 4 | Wire UI to Live API Data | [task-4](task-4-wire-ui-to-live-data.md) | not_started | Task 3 |
| 5 | Add Custom Server Dialog | [task-5](task-5-add-custom-server-dialog.md) | not_started | Task 3, Task 4 |

## Definition of Done

- SQLite database is initialized locally with required tables
- OAuth-ready tables exist for upcoming RFC 9470/RFC 8414 + PKCE implementation
- Pre-configured servers are seeded idempotently
- `/api/servers` and `/api/servers/[id]` support CRUD operations
- Main UI cards load from API responses instead of hardcoded data
- "Add Server" dialog allows creating custom servers and showing them in the UI
- Custom server delete flow works end-to-end
- `bun run build` succeeds without TypeScript errors
