# Sprint 4: MCP Capabilities Discovery

**Goal:** Use `@modelcontextprotocol/sdk` to connect to authenticated MCP servers, discover tools/resources/prompts, cache them, and display them in the inspector panel with tabs.

**Status:** in_progress

---

## How to Test This Sprint

Open `localhost:3000` and verify:
1. Connect to Notion (or another OAuth-enabled MCP server) and confirm capability discovery runs after successful OAuth completion
2. Confirm `GET /api/mcp/[serverId]/capabilities` returns normalized `tools`, `resources`, and optional `prompts`
3. Confirm inspector panel shows tabs for Tools, Resources, and Prompts with live counts
4. Confirm discovered capabilities are persisted in `mcp_capabilities` and reused on reload
5. Trigger token expiry/refresh scenario and confirm capability fetch still succeeds without manual reconnect when refresh is possible
6. Confirm transport fallback (streamable HTTP -> SSE) is attempted when primary transport fails
7. Confirm empty/error states are rendered clearly when a server exposes no tools/resources or discovery fails
8. `bun run build` succeeds

---

## Task Dependency Graph

```
Task 1 (MCP Client + Authenticated Transport) → Task 2 (Token-Aware Session + Transport Fallback)
Task 2 → Task 3 (Capabilities Discovery Service)
Task 3 → Task 4 (Capabilities Cache + API Route)
Task 4 → Task 5 (Inspector Tabs + Capability Lists)
Task 4 + Task 5 → Task 6 (Auto Rediscovery + Refresh Resilience)
```

## Tasks

| # | Task | File | Status | Depends On |
|---|------|------|--------|------------|
| 1 | MCP SDK Client Bootstrap + Authenticated Transport | [task-1](task-1-mcp-sdk-client-bootstrap.md) | done | — |
| 2 | Token-Aware MCP Session + Transport Fallback | [task-2](task-2-token-aware-session-and-fallback.md) | done | Task 1 |
| 3 | Capabilities Discovery (Tools/Resources/Prompts) | [task-3](task-3-capabilities-discovery-service.md) | done | Task 2 |
| 4 | Capabilities Cache + `/api/mcp/[serverId]/capabilities` | [task-4](task-4-capabilities-cache-and-api-route.md) | not_started | Task 3 |
| 5 | Inspector Tabs UI for Tools/Resources/Prompts | [task-5](task-5-inspector-capabilities-tabs-ui.md) | not_started | Task 4 |
| 6 | Auto Rediscovery + Token Refresh Resilience | [task-6](task-6-auto-rediscovery-and-resilience.md) | not_started | Task 4, Task 5 |

## Definition of Done

- MCP client connections use stored OAuth credentials and can authenticate against connected servers
- Capability discovery returns normalized tools/resources/prompts across supported transports
- Discovered capabilities are cached in SQLite and surfaced by a stable API route
- Inspector panel renders Tools/Resources/Prompts tabs with loading, empty, and error states
- Capability discovery remains functional across refreshable token expiry events
- Transport fallback behavior is implemented and observable for failed primary transports
- Notion capability discovery is manually verified end-to-end
- `bun run build` succeeds without TypeScript errors
