# Sprint 5: UI Navigation Refresh (Sidebar + Main Panel)

**Goal:** Replace the bottom inspector interaction model with a persistent desktop sidebar + main details panel layout, and add a mobile slide-over server list while preserving existing connect/disconnect and capabilities behaviors.

**Status:** not_started

---

## How to Test This Sprint

Open `localhost:3000` and verify:
1. Desktop layout shows a left sidebar for servers and a right main panel for selected server details
2. Sidebar groups servers into pre-configured and custom sections and keeps status visible per row
3. Selecting a server updates the main panel without opening a bottom drawer
4. Main panel preserves capabilities tabs (Tools, Resources, Prompts), refresh action, and stale/error messaging
5. Connect/disconnect/reconnect actions still work from the updated UI and reflect status changes in both sidebar and main panel
6. Mobile view shows a `Servers` button that opens a slide-over list; selecting a server closes the slide-over and loads details
7. Keyboard navigation works for server selection and mobile sheet dismissal (`Escape`)
8. `bun run build` succeeds

---

## Task Dependency Graph

```
Task 1 (IA + UX Contract) → Task 2 (Desktop Shell Layout)
Task 2 → Task 3 (Sidebar List + Row Actions)
Task 2 → Task 4 (Main Details Panel Migration)
Task 3 + Task 4 → Task 5 (Mobile Slide-Over Navigation)
Task 5 → Task 6 (Accessibility + Regression QA)
```

## Tasks

| # | Task | File | Status | Depends On |
|---|------|------|--------|------------|
| 1 | UI Information Architecture + Interaction Contract | [task-1](task-1-ui-information-architecture-and-interaction-contract.md) | done | — |
| 2 | Desktop Two-Pane Shell Layout | [task-2](task-2-desktop-two-pane-shell-layout.md) | done | Task 1 |
| 3 | Sidebar Server Navigation + Actions | [task-3](task-3-sidebar-server-navigation-and-actions.md) | done | Task 2 |
| 4 | Main Details Panel (Inspector Migration) | [task-4](task-4-main-details-panel-inspector-migration.md) | done | Task 2 |
| 5 | Mobile Slide-Over Server Picker | [task-5](task-5-mobile-slide-over-server-picker.md) | done | Task 3, Task 4 |
| 6 | Accessibility, Keyboard UX, and Regression QA | [task-6](task-6-accessibility-keyboard-and-regression-qa.md) | not_started | Task 5 |

## Definition of Done

- Bottom-fixed inspector panel is no longer the primary interaction pattern
- Desktop uses persistent sidebar + main details panel navigation
- Mobile uses slide-over server list with consistent selection behavior
- Existing capabilities discovery/refresh states remain functionally unchanged
- OAuth callback reconnect flow still lands user on the correct selected server context
- Connect/disconnect/delete flows remain stable after layout migration
- `bun run build` succeeds without TypeScript errors
