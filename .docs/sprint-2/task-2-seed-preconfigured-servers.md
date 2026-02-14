# Task 2: Seed Preconfigured Servers

**Sprint:** 2 - Database, API & Live Data
**Status:** done
**Depends on:** Task 1

## Description

Insert the pre-configured MCP servers into SQLite so API/UI can read a real persisted source of truth.

## Steps

1. Create a seeding script/module:
   - `lib/db/seed.ts` (or equivalent)
   - Read from `lib/data/preconfigured-servers.ts`

2. Map hardcoded server data to DB rows:
   - Set `is_preconfigured = 1`
   - Keep existing icon URLs and transport values

3. Make seed idempotent:
   - Use upsert-style behavior (`INSERT OR IGNORE` or update-on-conflict)
   - Re-running seed must not duplicate records

4. Run seed at app boot (or with an explicit script) so local setup is deterministic

## How to Test

- Run the seed flow twice
- Query `mcp_servers` and confirm there are exactly 6 pre-configured rows
- Confirm names/URLs match source data file

## Acceptance Criteria

- [x] All pre-configured servers are persisted in SQLite
- [x] Seeding is idempotent
- [x] Seed source remains `lib/data/preconfigured-servers.ts`
- [x] Pre-configured servers are ready for `/api/servers` responses
