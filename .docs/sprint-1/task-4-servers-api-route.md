# Task 4: Interactive Inspector Panel

**Sprint:** 1 - Interactive UI Shell
**Status:** done
**Depends on:** Task 3

## Description

Build the collapsible inspector panel at the bottom of the page. Clicking a server card selects it and expands the inspector to show that server's details. This is the core interaction pattern of the app.

## Steps

1. Create `components/inspector-panel.tsx`:
   - Fixed to bottom of viewport
   - **Collapsed state** (default): thin bar (~40px) showing "Inspector" label + chevron-up icon
   - **Expanded state**: slides up to ~40% of viewport height with smooth CSS transition
   - Click the bar to toggle collapsed/expanded
   - When a server is selected, auto-expand if collapsed

2. Inspector content when a server is selected:
   - Top bar: server icon + name + connection status badge + close (×) button
   - Body placeholder with 3 disabled tabs (using shadcn `Tabs`):
     - **Tools** tab → "Connect to discover tools" placeholder message
     - **Resources** tab → "Connect to discover resources" placeholder message
     - **History** tab → "No execution history" placeholder message
   - The tabs exist visually but are non-functional until Sprint 4/5

3. Inspector content when no server selected:
   - Centered message: "Select a server to inspect its tools and resources"
   - Muted text, subtle icon

4. Wire up the selection state in `app/page.tsx`:
   - `useState` for `selectedServerId: string | null`
   - Pass to `ServerGrid` (highlights the selected card) and `InspectorPanel`
   - Clicking a card calls `onSelectServer(id)`
   - Clicking × in inspector clears selection
   - Selected card gets a visual highlight (ring/border)

5. Add keyboard support:
   - `Escape` key closes the inspector panel / clears selection

## How to Test

- Open `localhost:3000`
- Bottom of page shows collapsed "Inspector" bar
- Click the bar → panel slides up (empty state message)
- Click a server card (e.g., Notion) → card gets highlight ring, inspector expands showing "Notion" with tabs
- Click a different card → inspector updates to show that server
- Click × in inspector → card deselects, inspector shows empty state
- Click inspector bar → collapses/expands
- Press Escape → inspector closes

## Acceptance Criteria

- [x] Inspector panel toggles between collapsed and expanded with smooth animation
- [x] Clicking a server card selects it (visual highlight) and opens inspector
- [x] Inspector shows selected server name, icon, status badge
- [x] Three placeholder tabs visible (Tools, Resources, History)
- [x] × button deselects server and shows empty state
- [x] Escape key closes inspector
- [x] Clicking another card switches the inspector content
- [x] Panel is resizable or has a sensible fixed height (~40vh)
