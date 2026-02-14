# Sprint 5 — UI Interaction Contract

This document defines the target interaction model for the sidebar + main panel navigation layout. It serves as the single source of truth for Tasks 2–6.

---

## 1. Desktop Layout Contract

```
┌─────────────────────────────────────────────────────────────────────┐
│ Header: MCP Client                                    [Add Server]  │
├──────────────────┬──────────────────────────────────────────────────┤
│ Sidebar (280px)  │ Main Panel (flex-1)                              │
│                  │                                                   │
│ PRE-CONFIGURED   │ ┌──────────────────────────────────────────────┐ │
│ ● Notion    [≡]  │ │ Server Header                                │ │
│   GitHub    [≡]  │ │ [Icon] Notion MCP          [Connected ●]     │ │
│   Sentry    [≡]  │ │ https://mcp.notion.com/mcp                   │ │
│                  │ │ [Disconnect] [Refresh Capabilities]           │ │
│ CUSTOM           │ ├──────────────────────────────────────────────┤ │
│   Internal  [≡]  │ │ [Tools 12] [Resources 3] [Prompts 0]        │ │
│                  │ │                                               │ │
│                  │ │ capability rows …                             │ │
│                  │ │                                               │ │
│                  │ └──────────────────────────────────────────────┘ │
│                  │                                                   │
│                  │ (empty state when no server selected)             │
└──────────────────┴──────────────────────────────────────────────────┘
```

### Sidebar
- **Width:** fixed 280px, not user-resizable
- **Sections:** "Pre-configured" and "Custom", each with a section heading
- **Rows:** Each row shows: server icon (or fallback), server name, connection status indicator (dot color), overflow menu trigger (`⋮`)
- **Selected state:** Highlighted background on the active row
- **Scrolling:** Sidebar scrolls independently if the list exceeds viewport height
- **Breakpoint:** Sidebar is visible at `≥ 768px` (md)

### Main Panel
- **Flex-1:** Takes remaining horizontal space
- **Empty state:** Centered message "Select a server from the sidebar" when no server is selected
- **Content:** Renders the selected server's header, action buttons, and capabilities tabs
- **Scrolling:** Main panel scrolls independently

---

## 2. Mobile Layout Contract (< 768px)

```
┌─────────────────────────────────┐
│ Header: MCP Client  [Servers ≡] │
├─────────────────────────────────┤
│ Main Panel (full width)         │
│                                 │
│ Server Header + Tabs            │
│ (or empty state)                │
│                                 │
└─────────────────────────────────┘

Slide-over (when [Servers] tapped):
┌─────────────────────────────────┐
│ ┌─────────────────────────────┐ │
│ │ Servers              [✕]   │ │
│ │                             │ │
│ │ PRE-CONFIGURED              │ │
│ │  Notion         Connected   │ │
│ │  GitHub         Connect     │ │
│ │                             │ │
│ │ CUSTOM                      │ │
│ │  Internal       Connect     │ │
│ └─────────────────────────────┘ │
│  (backdrop overlay)             │
└─────────────────────────────────┘
```

- **Sidebar hidden:** Below `md` breakpoint, the sidebar is not rendered in the DOM layout
- **Servers button:** Added to the header (right side, before "Add Server")
- **Slide-over:** Uses shadcn `Sheet` component, slides from the left, with backdrop overlay
- **Selection:** Tapping a server row closes the slide-over and loads that server in the main panel
- **Dismissal:** Close button, backdrop tap, or `Escape` key

---

## 3. Selection & Lifecycle Behavior

| Event | Behavior |
|-------|----------|
| **App loads** | No server selected. Main panel shows empty state. |
| **User clicks sidebar row** | That server becomes selected. Main panel updates. Previous selection replaced. |
| **OAuth callback returns** | The server that initiated OAuth becomes selected. Main panel opens with that server. |
| **Selected server deleted** | Selection cleared. Main panel returns to empty state. |
| **Selected server disconnected** | Server stays selected. Main panel updates status to "Not Connected". Capability tabs cleared. |
| **Server list refreshed** | If selected server still exists, selection preserved. If removed, selection cleared. |
| **Page refresh (F5)** | Selection is not persisted. Main panel shows empty state on reload. |

### Single-selection rule
Exactly zero or one server is selected at any time. There is no multi-select.

---

## 4. Action Placement Contract

### Sidebar Row Actions (quick access)
Each row exposes actions via an overflow menu (`⋮` icon button):

| Server State | Menu Items |
|--------------|------------|
| Disconnected | Connect |
| Connected | Disconnect |
| Expired | Reconnect |
| Custom (any state) | Delete (additional item) |

Pre-configured servers never show "Delete".

### Main Panel Actions (authoritative)
The main panel header shows explicit action buttons:

| Server State | Buttons |
|--------------|---------|
| Disconnected | `[Connect]` |
| Connected | `[Disconnect]` `[Refresh Capabilities]` |
| Expired | `[Reconnect]` `[Refresh Capabilities]` (disabled) |

### Action Ownership
- Both sidebar and main panel can trigger connect/disconnect/reconnect
- Delete is only available in the sidebar overflow menu (not in main panel)
- "Add Server" remains in the header (both desktop and mobile)
- Capability refresh is only in the main panel

---

## 5. Capabilities Tabs (Unchanged)

The main panel preserves the existing tab structure from Sprint 4:

- **Tabs:** Tools | Resources | Prompts
- **Tab badge:** Count of items (e.g., "Tools 12")
- **Loading state:** Skeleton rows during fetch
- **Empty state:** "No tools discovered" (per tab)
- **Error state:** Error message with retry button
- **Stale cache:** Warning banner with "Refresh" action
- **Auto-load:** Capabilities load automatically when a connected server is selected

No changes to the capabilities data model, API, or caching behavior.

---

## 6. Component Mapping (Current → New)

| Current Component | Disposition | New Component(s) |
|-------------------|------------|-------------------|
| `ServerGrid` | **Remove** | `Sidebar` (server list) |
| `ServerCard` | **Replace** | `SidebarServerRow` (compact row) |
| `InspectorPanel` | **Remove** | `MainDetailsPanel` (always visible) |
| `SelectedServerContent` | **Migrate** | Moves into `MainDetailsPanel` |
| `Header` | **Update** | Add mobile "Servers" button |
| `AddServerDialog` | **Keep** | No changes |
| `CapabilityListRows` | **Keep** | No changes |

---

## 7. Non-Goals for Sprint 5

- No new backend API routes or changes
- No database schema changes
- No tool execution UI (Sprint 6)
- No new data fetching logic (reuse existing hooks/fetchers)
- No drag-and-drop or reordering of servers
- No sidebar width resizing
- No persisting selected server across page reloads
- No changes to OAuth flow or token management
