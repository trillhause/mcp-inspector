# Task 2: Types, Constants & Hardcoded Server Data

**Sprint:** 1 - Interactive UI Shell
**Status:** done
**Depends on:** Task 1

## Description

Create shared TypeScript types and a hardcoded data file for the 6 pre-configured MCP servers. This data drives the UI for Sprint 1 — no database or API needed yet. In Sprint 2 we'll swap this for real API calls.

## Steps

1. Create `lib/types.ts` with shared types:
   ```typescript
   export type ConnectionStatus = "connected" | "disconnected" | "expired";

   export type McpServer = {
     id: string;
     name: string;
     description: string;
     mcp_url: string;
     transport: "auto" | "streamable_http" | "sse";
     icon_url: string;
     is_preconfigured: boolean;
     is_enabled: boolean;
     connection_status: ConnectionStatus;
     tool_count: number | null;
     resource_count: number | null;
     connected_at: string | null;
   };
   ```

2. Create `lib/data/preconfigured-servers.ts` with hardcoded server data:
   - Notion — `https://mcp.notion.com/mcp`
   - GitHub — `https://api.githubcopilot.com/mcp/`
   - Sentry — `https://mcp.sentry.io/sse`
   - Canva — `https://mcp.canva.com/mcp`
   - Figma — `https://mcp.figma.com/mcp`
   - PostHog — `https://mcp.posthog.com/mcp`
   - All set to `connection_status: "disconnected"`, `tool_count: null`

3. Add placeholder SVG icons in `public/icons/`:
   - `notion.svg`, `github.svg`, `sentry.svg`, `canva.svg`, `figma.svg`, `posthog.svg`
   - Simple recognizable icons (can use colored circles with first letter if needed)

## How to Test

- Import `PRECONFIGURED_SERVERS` from the data file — no errors
- TypeScript compiles cleanly
- Icons render at `/icons/notion.svg` etc. in the browser

## Acceptance Criteria

- [x] `lib/types.ts` exports `McpServer` and `ConnectionStatus` types
- [x] `lib/data/preconfigured-servers.ts` exports array of 6 servers
- [x] 6 SVG icon files exist in `public/icons/`
- [x] All types compile without errors
