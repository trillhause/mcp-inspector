# Task 1: Tool/Resource Interaction Contract + API Shapes

**Sprint:** 6 - Tool Execution & Resource Reading
**Status:** not_started
**Depends on:** none

## Description

Define stable interaction and payload contracts for tool execution and resource reading so backend and UI can evolve without provider-specific coupling.

## Steps

1. Define execution interaction model:
   - Tool selection from discovered capabilities
   - Parameter authoring from JSON schema-derived fields
   - Run state lifecycle (`idle`, `validating`, `executing`, `success`, `error`)

2. Define API contracts:
   - `POST /api/mcp/[serverId]/tools/[toolName]/execute`
   - `POST /api/mcp/[serverId]/resources/read`
   - Shared response envelope with deterministic error categories

3. Define validation boundaries:
   - Server-side validation is authoritative
   - Client-side validation is best-effort UX guidance
   - No trust in client-submitted schema metadata

4. Define normalization requirements:
   - Preserve raw MCP payload where safe
   - Return normalized summary fields for UI (`status`, `latency_ms`, `content_type`)

5. Define explicit non-goals for this sprint:
   - No provider-specific tool UI hardcoding
   - No write/update resource mutation workflows

## How to Test

- Review contract docs and confirm route names, request/response shapes, and error taxonomy are unambiguous
- Confirm both backend and frontend tasks can reference the same documented envelope without interpretation gaps

## Acceptance Criteria

- [ ] Tool execution and resource reading contracts are documented and implementation-ready
- [ ] API shape and error categories are consistent with prior MCP/OAuth APIs
- [ ] Scope boundaries are explicit (read/execute only, no mutation workflows)
