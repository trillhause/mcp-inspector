# Sprint 6: Tool Execution & Resource Reading

**Goal:** Build dynamic tool parameter forms from MCP schemas, execute tools against authenticated MCP servers, read resources, and present results with syntax highlighting and execution history.

**Status:** in_progress

---

## How to Test This Sprint

Open `localhost:3000` and verify:
1. Select a connected server and confirm Tools and Resources remain visible in the main details panel
2. Click a tool and confirm a form is generated from its input schema (required and optional fields shown correctly)
3. Submit valid tool parameters and confirm execution runs against `POST /api/mcp/[serverId]/tools/[toolName]/execute`
4. Confirm tool results render in a readable JSON-highlighted result pane with clear success/error states
5. Click a resource and confirm content is fetched from `POST /api/mcp/[serverId]/resources/read` and rendered with a content-aware viewer
6. Confirm auth/session resilience still works (refresh when needed, reconnect-required surfaced when refresh cannot recover)
7. Confirm execution history records tool calls and resource reads with timestamp, server, target, status, and latency metadata
8. `bun run build` succeeds

---

## Task Dependency Graph

```
Task 1 (Execution + Resource Interaction Contract) → Task 2 (Tool Execution Service + API)
Task 1 → Task 3 (Resource Reading Service + API)
Task 2 → Task 4 (Dynamic Tool Form + Execute UX)
Task 3 → Task 5 (Resource Viewer + Result Rendering)
Task 4 + Task 5 → Task 6 (Execution History + Cross-Server Regression QA)
```

## Tasks

| # | Task | File | Status | Depends On |
|---|------|------|--------|------------|
| 1 | Tool/Resource Interaction Contract + API Shapes | [task-1](task-1-tool-resource-interaction-contract-and-api-shapes.md) | done | — |
| 2 | Tool Execution Service + API Route | [task-2](task-2-tool-execution-service-and-api-route.md) | done | Task 1 |
| 3 | Resource Reading Service + API Route | [task-3](task-3-resource-reading-service-and-api-route.md) | done | Task 1 |
| 4 | Dynamic Tool Parameter Form + Execute UX | [task-4](task-4-dynamic-tool-parameter-form-and-execute-ux.md) | done | Task 2 |
| 5 | Resource Viewer + JSON Result Rendering | [task-5](task-5-resource-viewer-and-json-result-rendering.md) | not_started | Task 3 |
| 6 | Execution History + Cross-Server Regression QA | [task-6](task-6-execution-history-and-cross-server-regression-qa.md) | not_started | Task 4, Task 5 |

## Definition of Done

- Tool execution works from UI to API to MCP server for authenticated connections
- Resource reading works for supported URIs with clear content/error rendering
- Dynamic forms are generated from tool schemas without hardcoding provider-specific fields
- Result rendering supports readable JSON output with copy/debug utility affordances
- Execution history is persisted and viewable per server
- Token refresh and reconnect-required behavior remain resilient during tool/resource actions
- At least Notion plus one additional OAuth-enabled MCP provider are manually validated
- `bun run build` succeeds without TypeScript errors
