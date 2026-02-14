# Task 3: App Layout & Server Cards Grid

**Sprint:** 1 - Interactive UI Shell
**Status:** not_started
**Depends on:** Task 2

## Description

Build the full page layout (header, main content area, server card grid) using shadcn/ui and hardcoded data. After this task you can see and interact with the server cards.

## Steps

1. Update `app/layout.tsx`:
   - Set page metadata: title "MCP Client", description
   - Keep existing font setup or switch to Geist/Geist Mono

2. Create `components/header.tsx`:
   - Left: app title "MCP Client" (bold, with a subtle icon or terminal-style accent)
   - Right: "Add Server" button (ghost/outline style, **disabled** — wired in Sprint 2)
   - Thin border-bottom to separate from content

3. Create `components/server-card.tsx`:
   - Uses shadcn `Card` component
   - Layout: icon (32x32) + name on top row, description below (2 line clamp)
   - Connection status badge (shadcn `Badge`):
     - `disconnected` → gray "Not Connected"
     - `connected` → green "Connected"
     - `expired` → yellow "Reconnect"
   - Tool count if connected (e.g., "12 tools · 3 resources")
   - Bottom: "Connect" button (primary, **disabled** — wired in Sprint 3)
   - Hover state: subtle border highlight or shadow lift
   - Accept an `onSelect` callback prop (wired in Task 4)

4. Create `components/server-grid.tsx`:
   - Import hardcoded `PRECONFIGURED_SERVERS` from `lib/data/`
   - Responsive CSS grid: 1 col mobile, 2 cols tablet, 3 cols desktop
   - Section: "Servers" heading above the grid
   - Accept `selectedServerId` and `onSelectServer` props

5. Update `app/page.tsx`:
   - Render: Header → ServerGrid → (inspector panel placeholder div at bottom)
   - Full height layout using flex column

## How to Test

- `bun run dev` → open `localhost:3000`
- See 6 server cards in a responsive grid
- Each card shows: icon, name, description, gray "Not Connected" badge, disabled "Connect" button
- Resize browser → grid reflows (3 → 2 → 1 columns)
- Cards have hover state

## Acceptance Criteria

- [ ] Header renders with title and disabled "Add Server" button
- [ ] 6 server cards visible in a responsive grid
- [ ] Each card shows icon, name, description, status badge
- [ ] Cards have hover effect
- [ ] Layout fills viewport height, no horizontal scroll
- [ ] Works in dark mode (if system prefers dark)
