# Task 1: SQLite Setup & Schema

**Sprint:** 2 - Database, API & Live Data
**Status:** done
**Depends on:** none

## Description

Set up the SQLite database foundation and create the base schema used by server management and later OAuth/capabilities work.

## Steps

1. Create database connection utilities:
   - `lib/db.ts` for a singleton `better-sqlite3` connection
   - Use a local DB file path (for example `./data/mcp-client.db`)

2. Create schema definitions for Sprint 2 data needs:
   - `mcp_servers`
   - Include key fields used by the UI/API: `id`, `name`, `description`, `mcp_url`, `transport`, `icon_url`, `is_preconfigured`, `is_enabled`, `created_at`, `updated_at`

3. Create forward-compatible OAuth tables needed by Notion MCP flow in Sprint 3:
   - `oauth_credentials` with `mcp_server_id` unique, `client_id`, optional `client_secret`, `access_token`, `refresh_token`, `token_expires_at`, `oauth_metadata`, `protected_resource_url`, `authorization_server_url`, timestamps
   - `oauth_state` with `state_value` unique, `code_verifier`, `redirect_uri`, `expires_at`
   - Add foreign keys to `mcp_servers`

4. Add schema initialization/migration bootstrap:
   - Ensure tables are created with `CREATE TABLE IF NOT EXISTS`
   - Add indexes/constraints for `mcp_url` uniqueness and common lookups

5. Add shared DB helper methods used by API routes (query + execute wrappers)

## How to Test

- Start app with `bun run dev` and confirm no DB initialization errors
- Confirm SQLite file is created locally
- Confirm `mcp_servers` table exists and has expected columns
- Confirm `oauth_credentials` and `oauth_state` tables exist with expected unique keys

## Acceptance Criteria

- [x] `better-sqlite3` connection is initialized once and reused
- [x] `mcp_servers` schema exists with required fields and constraints
- [x] `oauth_credentials` and `oauth_state` exist for upcoming PKCE + token storage flow
- [x] DB setup runs automatically in local development
- [x] No runtime errors when app starts with a fresh workspace
