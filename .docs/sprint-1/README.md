# Sprint 1: Interactive UI Shell

**Goal:** Install deps, init shadcn/ui, and build the full visual shell with hardcoded server data. No database or API yet — just a working, interactive UI you can click through.

**Status:** in_progress

---

## How to Test This Sprint

Open `localhost:3000` and verify:
1. See 6 server cards (Notion, GitHub, Sentry, Canva, Figma, PostHog) in a responsive grid
2. Each card has an icon, name, description, and gray "Not Connected" badge
3. Bottom of page has a collapsed "Inspector" bar
4. Click a card → card gets highlighted, inspector panel slides up showing that server's name and placeholder tabs (Tools, Resources, History)
5. Click a different card → inspector switches to that server
6. Click × in inspector → selection clears, inspector shows empty state
7. Click inspector bar → toggle collapse/expand
8. Press Escape → inspector closes
9. Resize browser → grid reflows responsively

---

## Task Dependency Graph

```
Task 1 (Deps + shadcn) → Task 2 (Types + Data + Icons) → Task 3 (Layout + Cards) → Task 4 (Inspector Panel)
```

All tasks are sequential — each builds on the previous.

## Tasks

| # | Task | File | Status | Depends On |
|---|------|------|--------|------------|
| 1 | Install Dependencies & Initialize shadcn/ui | [task-1](task-1-install-dependencies.md) | done | — |
| 2 | Types, Constants & Hardcoded Server Data | [task-2](task-2-database-setup.md) | done | Task 1 |
| 3 | App Layout & Server Cards Grid | [task-3](task-3-seed-preconfigured-servers.md) | not_started | Task 2 |
| 4 | Interactive Inspector Panel | [task-4](task-4-servers-api-route.md) | not_started | Task 3 |

## Definition of Done

- `bun run dev` starts, `localhost:3000` renders the full UI
- 6 pre-configured server cards in a responsive grid
- Clicking cards opens the inspector panel with server details
- Inspector has placeholder tabs (Tools, Resources, History)
- `bun run build` succeeds
- No database, no API calls — purely frontend with hardcoded data
