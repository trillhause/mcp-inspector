# Task 2: Tool Execution Service + API Route

**Sprint:** 6 - Tool Execution & Resource Reading
**Status:** not_started
**Depends on:** Task 1

## Description

Implement authenticated tool execution against MCP servers with strict validation, resilient session handling, and normalized response payloads.

## Steps

1. Create tool execution service module:
   - `lib/mcp/tool-execution.ts`
   - `executeTool(serverId, toolName, arguments)` entrypoint

2. Reuse token-aware MCP session lifecycle:
   - Use existing refresh-aware connect flow from Sprint 4
   - Preserve streamable HTTP -> SSE fallback behavior where configured

3. Add request validation and guardrails:
   - Validate `toolName` exists for server capabilities
   - Validate `arguments` shape against discovered `inputSchema` (when available)
   - Reject oversized or invalid payloads with structured errors

4. Implement API route:
   - `POST /api/mcp/[serverId]/tools/[toolName]/execute`
   - Return normalized payload with raw result passthrough when safe

5. Standardize failure mapping:
   - `NOT_CONNECTED`, `AUTH_REQUIRED`, `RECONNECT_REQUIRED`, `VALIDATION_ERROR`, `EXECUTION_FAILED`

## How to Test

- Execute a known tool with valid input and confirm a successful normalized response
- Submit invalid params and confirm deterministic `VALIDATION_ERROR` response
- Simulate expired credentials and confirm refresh/reconnect-required behavior remains correct
- Verify sensitive values are not logged in plaintext

## Acceptance Criteria

- [ ] Tool execution route works end-to-end for connected servers
- [ ] Validation and error mapping are deterministic and machine-readable
- [ ] Existing token refresh and transport fallback behavior remains intact
- [ ] Response contract is stable for UI rendering
