# Task 3: Capabilities Discovery (Tools/Resources/Prompts)

**Sprint:** 4 - MCP Capabilities Discovery
**Status:** not_started
**Depends on:** Task 2

## Description

Implement capability discovery service methods that query MCP servers for tools, resources, and prompts, then normalize outputs for API/UI usage.

## Steps

1. Create discovery service module:
   - `lib/mcp/discovery.ts`
   - `discoverCapabilities(serverId)` returns normalized payload

2. Discover tools:
   - Call MCP tools listing endpoint via SDK
   - Normalize tool fields (`name`, `description`, `inputSchema`)

3. Discover resources:
   - Call MCP resources listing endpoint via SDK
   - Normalize resource fields (`uri`, `name`, `description`, `mimeType`)

4. Discover prompts (if supported):
   - Call prompts listing endpoint when available
   - Keep prompts optional in normalized output

5. Normalize and validate payload shape:
   - Stable JSON contract for storage and UI rendering
   - Include `discovered_at` and transport metadata

## How to Test

- Run discovery against a connected Notion server and confirm non-empty tools list
- Run discovery against a server with no prompts and confirm prompts field remains optional
- Validate normalized payload schema is stable and serializable for DB storage

## Acceptance Criteria

- [ ] Discovery service returns tools/resources and optional prompts in one payload
- [ ] Output is normalized to a consistent server-agnostic shape
- [ ] Discovery handles partial capability support without hard failures
- [ ] Notion capability listing is manually verified
