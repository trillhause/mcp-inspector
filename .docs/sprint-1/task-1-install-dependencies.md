# Task 1: Install Dependencies & Initialize shadcn/ui

**Sprint:** 1 - Interactive UI Shell
**Status:** done
**Depends on:** none

## Description

Install all project dependencies and initialize shadcn/ui. After this task, the project has all the building blocks ready.

## Steps

1. Install production dependencies:
   ```bash
   bun add @modelcontextprotocol/sdk better-sqlite3 uuid
   ```

2. Install dev dependencies:
   ```bash
   bun add -d @types/better-sqlite3 @types/uuid
   ```

3. Initialize shadcn/ui:
   ```bash
   bunx shadcn@latest init
   ```
   - Style: Default
   - Base color: Zinc (inspector/dev-tool feel)
   - CSS variables: Yes

4. Add the shadcn/ui components we'll need:
   ```bash
   bunx shadcn@latest add button card badge separator tabs scroll-area collapsible tooltip
   ```

5. Verify everything works:
   ```bash
   bun run dev   # should start
   bun run build # should succeed
   ```

## How to Test

- `bun run dev` starts without errors
- `localhost:3000` loads (still shows default Next.js page, that's fine)
- `components/ui/` directory exists with shadcn components

## Acceptance Criteria

- [x] All dependencies in package.json
- [x] shadcn/ui initialized, `components/ui/` has button, card, badge, etc.
- [x] `bun run build` succeeds with no TypeScript errors
