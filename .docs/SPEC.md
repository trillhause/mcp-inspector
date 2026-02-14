# MCP Client Web Application - Specification

## Project Overview

A web-based universal MCP (Model Context Protocol) client that enables users to connect to multiple MCP servers with OAuth 2.0 authentication, explore their capabilities (tools and resources), and interactively test them.

### Core Value Proposition

- **Universal Compatibility**: Works with any MCP server implementing standard OAuth 2.0 + PKCE authentication
- **Pre-configured Servers**: One-click connection to popular MCP servers (Notion, GitHub, Sentry, Canva, Figma, PostHog)
- **Interactive Testing**: Explore tools/resources and execute them directly from the UI
- **Local-First**: SQLite database keeps all data on the user's machine
- **Developer-Friendly**: Inspector-style UI inspired by Claude Code

---

## Technical Stack

| Category | Technology | Rationale |
|----------|------------|-----------|
| Runtime | **Bun** | Fast, native TypeScript support, built-in package manager |
| Framework | **Next.js 15** (App Router) | Full-stack React with API routes, great DX |
| Language | **TypeScript** | Type safety for MCP protocol handling |
| UI Library | **shadcn/ui** | Modern, accessible, customizable components |
| Styling | **Tailwind CSS** | Utility-first, works seamlessly with shadcn/ui |
| Database | **SQLite** (via better-sqlite3) | Local-only, zero-config, embedded |
| OAuth | **Custom implementation** | Full control over RFC 9470 + RFC 8414 discovery |
| MCP SDK | **@modelcontextprotocol/sdk** | Official MCP client implementation |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Next.js Application                          │
├─────────────────────────────────────────────────────────────────────┤
│  Frontend (React + shadcn/ui)          Backend (API Routes)         │
│  ┌─────────────────────────────┐      ┌─────────────────────────┐  │
│  │ - Server Sidebar            │      │ - OAuth Discovery       │  │
│  │ - Main Details Panel        │◄────►│ - Token Exchange         │  │
│  │ - Capability Tabs           │      │ - MCP Connection        │  │
│  │ - Tool/Resource Execution   │      │ - Tool/Resource Calls   │  │
│  └─────────────────────────────┘      └─────────────────────────┘  │
│                   ▲                                 ▲                │
│                   │                                 │                │
│                   ▼                                 ▼                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    SQLite Database                          │   │
│  │  - mcp_servers (pre-configured + user-added)                │   │
│  │  - oauth_credentials (tokens, metadata)                     │   │
│  │  - execution_history (optional, for debugging)              │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────┐
                    │  External MCP      │
                    │  Servers (HTTP)    │
                    │  - Notion          │
                    │  - GitHub          │
                    │  - Sentry          │
                    │  - + user added    │
                    └────────────────────┘
```

---

## Database Schema

```sql
-- Pre-configured and user-added MCP servers
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  mcp_url TEXT NOT NULL UNIQUE,        -- Base URL (e.g., https://mcp.notion.com)
  transport TEXT NOT NULL DEFAULT 'auto',  -- 'auto', 'streamable_http', 'sse'
  icon_url TEXT,
  is_preconfigured BOOLEAN NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OAuth 2.0 credentials for connected servers
CREATE TABLE oauth_credentials (
  id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret TEXT,                    -- Null for public clients (PKCE-only)
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TEXT,                 -- ISO 8601 datetime
  scopes TEXT,                           -- JSON array or space-separated
  oauth_metadata TEXT NOT NULL,          -- Full OAuth server metadata (JSON)
  protected_resource_url TEXT,           -- From RFC 9470 discovery
  authorization_server_url TEXT,         -- Discovered auth server URL
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_refreshed_at TEXT,
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

-- Temporary OAuth state (for PKCE flow)
CREATE TABLE oauth_state (
  id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL,
  state_value TEXT NOT NULL UNIQUE,      -- CSRF protection
  code_verifier TEXT NOT NULL,           -- PKCE verifier
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,              -- Short-lived (10 min)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

-- MCP server capabilities (cached after connection)
CREATE TABLE mcp_capabilities (
  id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL UNIQUE,
  tools TEXT NOT NULL,                   -- JSON: available tools
  resources TEXT NOT NULL,               -- JSON: available resources
  prompts TEXT,                          -- JSON: available prompts (optional)
  last_discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

-- Execution history (for debugging/testing)
CREATE TABLE execution_history (
  id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL,
  type TEXT NOT NULL,                    -- 'tool' or 'resource'
  name TEXT NOT NULL,                    -- Tool/resource name
  arguments TEXT,                        -- JSON: arguments passed
  result TEXT,                           -- JSON: result returned
  error TEXT,                            -- Error message if failed
  duration_ms INTEGER,
  executed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX idx_oauth_credentials_server ON oauth_credentials(mcp_server_id);
CREATE INDEX idx_oauth_state_expires ON oauth_state(expires_at);
CREATE INDEX idx_capabilities_server ON mcp_capabilities(mcp_server_id);
CREATE INDEX idx_execution_history_server ON execution_history(mcp_server_id, executed_at DESC);
```

---

## API Design (Next.js API Routes)

### OAuth & Authentication

| Route | Method | Description |
|-------|--------|-------------|
| `/api/oauth/discover` | POST | Discover OAuth metadata for an MCP server URL |
| `/api/oauth/register` | POST | Dynamic client registration (RFC 7591) |
| `/api/oauth/authorize` | POST | Initiate OAuth flow (returns auth URL) |
| `/api/oauth/callback` | POST | Handle OAuth callback (exchange code for tokens) |
| `/api/oauth/refresh` | POST | Refresh access token |
| `/api/oauth/revoke` | DELETE | Revoke tokens and disconnect server |

### MCP Server Management

| Route | Method | Description |
|-------|--------|-------------|
| `/api/servers` | GET | List all MCP servers (pre-configured + user-added) |
| `/api/servers` | POST | Add a new custom MCP server |
| `/api/servers/[id]` | GET | Get server details |
| `/api/servers/[id]` | PATCH | Update server settings |
| `/api/servers/[id]` | DELETE | Remove a server |
| `/api/servers/[id]/connect` | POST | Initiate connection (OAuth flow) |
| `/api/servers/[id]/disconnect` | POST | Disconnect and clear credentials |

### MCP Interactions

| Route | Method | Description |
|-------|--------|-------------|
| `/api/mcp/[serverId]/capabilities` | GET | Get tools, resources, prompts (cached or fresh) |
| `/api/mcp/[serverId]/tools/[toolName]` | POST | Execute a specific tool |
| `/api/mcp/[serverId]/resources/[resourceUri]` | GET | Read a specific resource |
| `/api/mcp/[serverId]/test` | POST | Test connection and discover capabilities |

---

## OAuth 2.0 Flow (RFC 9470 + RFC 8414)

### Discovery Phase

```
1. User enters MCP Server URL: https://mcp.notion.com
                │
                ▼
2. GET /.well-known/oauth-protected-resource
   → Returns: { "authorization_servers": ["https://auth.notion.com"] }
                │
                ▼
3. GET {authServer}/.well-known/oauth-authorization-server
   → Returns: { authorization_endpoint, token_endpoint, ... }
                │
                ▼
4. Store metadata for use in auth flow
```

### Authorization Phase

```
┌─────────┐                    ┌──────────────┐                  ┌─────────────┐
│  Client │                    │   Next.js    │                  │ Auth Server │
└────┬────┘                    └──────┬───────┘                  └──────┬──────┘
     │                                │                                 │
     │  1. POST /api/oauth/authorize  │                                 │
     │  ─────────────────────────────►│                                 │
     │  { mcp_server_id }             │                                 │
     │                                │                                 │
     │                                │  2. Generate PKCE              │
     │                                │     code_verifier + challenge  │
     │                                │                                 │
     │                                │  3. Store in oauth_state       │
     │                                │                                 │
     │  4. Return auth_url            │                                 │
     │  ◄─────────────────────────────│                                 │
     │                                │                                 │
     │  5. Redirect user              │                                 │
     │  ──────────────────────────────────────────────────────────────► │
     │                                │                                 │
     │  6. User approves              │                                 │
     │                                │                                 │
     │  7. Redirect with code         │                                 │
     │  ◄────────────────────────────────────────────────────────────── │
     │     ?code=xxx&state=yyy        │                                 │
     │                                │                                 │
     │  8. POST /api/oauth/callback   │                                 │
     │  ─────────────────────────────►│                                 │
     │  { code, state }               │                                 │
     │                                │                                 │
     │                                │  9. Validate state,            │
     │                                │     exchange code + verifier   │
     │                                │     for tokens                 │
     │                                │                                 │
     │                                │  10. POST token_endpoint       │
     │                                │  ──────────────────────────────────────────────►
     │                                │                                 │
     │                                │  11. Receive tokens            │
     │                                │  ◄──────────────────────────────────────────────┘
     │                                │                                 │
     │  12. Success, tokens stored    │                                 │
     │  ◄─────────────────────────────│                                 │
     │                                │                                 │
```

---

## UI/UX Design (Sidebar + Main Panel)

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Header: MCP Client                                         [Add Server]│
├─────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────┬────────────────────────────────────────┐ │
│ │ Sidebar                    │ Main Panel                             │ │
│ │ Search servers...          │ [Icon] Notion MCP      [Connected]     │ │
│ │ -------------------------- │ URL: https://mcp.notion.com/mcp        │ │
│ │ PRE-CONFIGURED             │ [Disconnect] [Refresh capabilities]    │ │
│ │ > Notion         Connected │ -------------------------------------- │ │
│ │ > GitHub         Connect   │ Tabs: [Tools] [Resources] [Prompts]    │ │
│ │ > Sentry         Reconnect │ - capability rows                       │ │
│ │                            │ - loading / empty / error states        │ │
│ │ CUSTOM                     │ - execution result pane (Sprint 6+)     │ │
│ │ > Internal API   Connect   │                                          │ │
│ │ > Team Wiki      Connected │                                          │ │
│ └────────────────────────────┴────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key UI Components

| Component | Description |
|-----------|-------------|
| **Server List Item** | Compact row in the sidebar showing name, icon, connection status, and quick actions |
| **Connect Button** | Triggers OAuth flow for unconnected servers; shows "Connected" with timestamp for active ones |
| **Details Panel** | Main content panel showing selected server metadata, capabilities tabs, and execution workspace |
| **Tool Executor** | Form-based UI for executing tools with parameter inputs based on tool schema |
| **Resource Reader** | Read-only view for resource contents |
| **Add Server Modal** | Form to add custom MCP servers by URL with automatic OAuth discovery |
| **Status Badges** | Visual indicators for connection state, token expiry, last sync |

---

## Pre-configured MCP Servers

| Server | MCP URL | Notes |
|--------|---------|-------|
| Notion | `https://mcp.notion.com/mcp` | Transport: auto (try streamable, fallback to SSE) |
| GitHub | `https://mcp.github.com/mcp` | *(URL to be verified)* |
| Sentry | `https://mcp.sentry.io/mcp` | *(URL to be verified)* |
| Canva | `https://mcp.canva.com/mcp` | *(URL to be verified)* |
| Figma | `https://mcp.figma.com/mcp` | *(URL to be verified)* |
| PostHog | `https://mcp.posthog.com/mcp` | *(URL to be verified)* |

> **Note**: These URLs will be verified during implementation. If official MCP endpoints don't exist for some services, they will be removed from the pre-configured list.

---

## Security Considerations

### Token Storage
- Tokens stored in plain text in SQLite (local-only app)
- Database file respects OS file permissions
- No external API exposure of tokens
- Tokens never logged or sent to analytics

### OAuth Security
- **PKCE mandatory**: Always use S256 code challenge method
- **State parameter**: CSRF protection with random 32-byte values
- **Short-lived OAuth state**: 10-minute expiry
- **Redirect URI validation**: Enforce whitelist in production
- **Token refresh**: Automatic refresh before expiry (5-minute buffer)

### Transport Security
- All external requests use HTTPS only
- SSL certificate validation enforced
- No HTTP except for localhost development

### Input Validation
- MCP server URLs validated before storage
- OAuth discovery responses validated against schema
- Tool/resource names sanitized before execution

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Set up Next.js project with Bun, TypeScript, Tailwind, shadcn/ui
- [ ] Configure SQLite database with schema
- [ ] Create database seed file with pre-configured servers
- [ ] Set up basic UI layout (header, sidebar, main panel)
- [ ] Implement server list view

### Phase 2: OAuth Integration (Week 2)
- [ ] Implement RFC 9470 + RFC 8414 OAuth discovery
- [ ] Create API routes for OAuth flow (authorize, callback, refresh)
- [ ] Implement PKCE generation and validation
- [ ] Build OAuth state management in database
- [ ] Create connect/disconnect functionality
- [ ] Test with Notion MCP server

### Phase 3: MCP Client Integration (Week 3)
- [ ] Install and configure `@modelcontextprotocol/sdk`
- [ ] Implement server connection with authenticated transport
- [ ] Build capability discovery (tools, resources, prompts)
- [ ] Cache capabilities in database
- [ ] Handle token refresh on 401/unauthorized errors
- [ ] Implement automatic transport fallback (streamable → SSE)

### Phase 4: UI Navigation Refresh (Week 4)
- [ ] Replace bottom inspector interaction with sidebar + main panel layout
- [ ] Implement grouped server navigation (pre-configured + custom) in sidebar
- [ ] Implement mobile slide-over server list with full-width detail panel
- [ ] Preserve existing capabilities tabs, refresh, and warning/error states in main panel
- [ ] Keep connect/disconnect/delete flows available from the new layout
- [ ] Validate keyboard navigation, focus, and responsive behavior

### Phase 5: Tool & Resource Exploration (Week 5)
- [ ] Build tools/resources list view in main details panel
- [ ] Create dynamic form generator for tool parameters
- [ ] Implement tool execution API route
- [ ] Build resource reading API route
- [ ] Display execution results with JSON syntax highlighting
- [ ] Add execution history tracking

### Phase 6: Polish & Testing (Week 6)
- [ ] Add loading states and error handling
- [ ] Implement token expiry warnings
- [ ] Add custom server addition flow
- [ ] Build server settings/modal UI
- [ ] Test with multiple MCP servers
- [ ] Documentation and setup instructions

---

## File Structure (Proposed)

```
mcp-auth-experiment/
├── app/
│   ├── (routes)/
│   │   ├── page.tsx                 # Main server list
│   │   ├── servers/
│   │   │   ├── [id]/
│   │   │   │   └── page.tsx         # Server detail view
│   │   │   └── new/
│   │   │       └── page.tsx         # Add custom server
│   │   └── oauth/
│   │       └── callback/
│   │           └── route.ts         # OAuth callback handler
│   ├── api/
│   │   ├── oauth/
│   │   │   ├── discover/route.ts
│   │   │   ├── authorize/route.ts
│   │   │   ├── callback/route.ts
│   │   │   ├── refresh/route.ts
│   │   │   └── revoke/route.ts
│   │   ├── servers/
│   │   │   ├── route.ts
│   │   │   ├── [id]/
│   │   │   │   ├── route.ts
│   │   │   │   ├── connect/route.ts
│   │   │   │   └── disconnect/route.ts
│   │   └── mcp/
│   │       └── [serverId]/
│   │           ├── capabilities/route.ts
│   │           ├── tools/
│   │           │   └── [toolName]/route.ts
│   │           └── resources/
│   │               └── [...path]/route.ts
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                          # shadcn/ui components
│   ├── server-sidebar.tsx
│   ├── server-list-item.tsx
│   ├── server-details-panel.tsx
│   ├── tool-executor.tsx
│   ├── resource-reader.tsx
│   └── add-server-modal.tsx
├── lib/
│   ├── db.ts                        # SQLite connection
│   ├── schema.ts                    # Database schema
│   ├── oauth/
│   │   ├── discovery.ts             # RFC 9470 + RFC 8414
│   │   ├── pkce.ts                  # PKCE utilities
│   │   └── client.ts                # OAuth client logic
│   └── mcp/
│       ├── client.ts                # MCP client wrapper
│       └── transport.ts             # Transport layer
├── prisma/                          # Or direct SQL
│   └── schema.sql
├── public/
│   └── icons/                       # MCP server icons
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── SPEC.md
```

---

## Open Questions & Decisions Needed

1. **Redirect URI**: Should we use a custom scheme (e.g., `mcp-client://oauth/callback`) or a local HTTP server (`http://localhost:3000/api/oauth/callback`)?
   - *Recommendation*: Local HTTP server for simplicity, can explore custom scheme later

2. **Token Refresh Strategy**: Should we refresh proactively (before expiry) or reactively (on 401)?
   - *Recommendation*: Hybrid: proactively refresh 5 minutes before expiry, with reactive fallback

3. **MCP Server URLs to Verify**: GitHub, Sentry, Canva, Figma, and PostHog MCP server URLs need verification during implementation

4. **Execution History**: Keep full history or limit to last N entries?
   - *Recommendation*: Limit to last 100 entries per server, with option to clear

---

## Success Criteria

- [ ] User can connect to Notion MCP server with OAuth
- [ ] User can add a custom MCP server by URL and connect to it
- [ ] User can view tools and resources for connected servers
- [ ] User can execute tools with parameters and see results
- [ ] User can read resources
- [ ] Tokens refresh automatically when expired
- [ ] All data stored locally in SQLite
- [ ] App works offline (except for MCP server communication)

---

*Last Updated: 2026-02-14*
