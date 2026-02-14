import "server-only";

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { Database as SqliteDatabase, Statement as SqliteStatement } from "better-sqlite3";

type PrimitiveSqlParam = string | number | bigint | Buffer | null;
export type SqlParams = PrimitiveSqlParam[] | Record<string, PrimitiveSqlParam>;

const DEFAULT_DB_FILE_PATH = join(process.cwd(), "data", "mcp-client.db");

declare global {
  var __mcpClientDb: SqliteDatabase | undefined;
  var __mcpClientDbInitialized: boolean | undefined;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  mcp_url TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL DEFAULT 'auto' CHECK (transport IN ('auto', 'streamable_http', 'sse')),
  icon_url TEXT,
  is_preconfigured INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled_sort
ON mcp_servers(is_enabled, is_preconfigured, name);

CREATE TABLE IF NOT EXISTS oauth_credentials (
  id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TEXT,
  oauth_metadata TEXT NOT NULL,
  protected_resource_url TEXT,
  authorization_server_url TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_refreshed_at TEXT,
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_credentials_server
ON oauth_credentials(mcp_server_id);

CREATE TABLE IF NOT EXISTS oauth_state (
  id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL,
  state_value TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_expires
ON oauth_state(expires_at);
`;

function getDbFilePath() {
  return process.env.MCP_CLIENT_DB_PATH ?? DEFAULT_DB_FILE_PATH;
}

const require = createRequire(import.meta.url);

function loadBetterSqlite3() {
  const sqliteModule = require("better-sqlite3") as typeof import("better-sqlite3");
  return sqliteModule;
}

function createDatabaseConnection() {
  const dbFilePath = getDbFilePath();
  mkdirSync(dirname(dbFilePath), { recursive: true });

  const BetterSqlite3 = loadBetterSqlite3();
  const db = new BetterSqlite3(dbFilePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function getDb() {
  if (!globalThis.__mcpClientDb) {
    globalThis.__mcpClientDb = createDatabaseConnection();
  }

  return globalThis.__mcpClientDb;
}

export function initializeDatabase() {
  if (globalThis.__mcpClientDbInitialized) {
    return;
  }

  const db = getDb();
  db.exec(SCHEMA_SQL);
  globalThis.__mcpClientDbInitialized = true;
}

type QueryRow = Record<string, unknown>;

export function dbQueryAll<TRow extends QueryRow = QueryRow>(sql: string, params?: SqlParams) {
  const statement = getDb().prepare(sql);

  if (!params) {
    return (statement as SqliteStatement<unknown[]>).all(...[]) as TRow[];
  }

  if (Array.isArray(params)) {
    return (statement as SqliteStatement<unknown[]>).all(...params) as TRow[];
  }

  return (statement as SqliteStatement<Record<string, PrimitiveSqlParam>>).all(params) as TRow[];
}

export function dbQueryFirst<TRow extends QueryRow = QueryRow>(sql: string, params?: SqlParams) {
  const statement = getDb().prepare(sql);

  if (!params) {
    return (statement as SqliteStatement<unknown[]>).get(...[]) as TRow | undefined;
  }

  if (Array.isArray(params)) {
    return (statement as SqliteStatement<unknown[]>).get(...params) as TRow | undefined;
  }

  return (statement as SqliteStatement<Record<string, PrimitiveSqlParam>>).get(
    params,
  ) as TRow | undefined;
}

export function dbExecute(sql: string, params?: SqlParams) {
  const statement = getDb().prepare(sql);

  if (!params) {
    return (statement as SqliteStatement<unknown[]>).run(...[]);
  }

  if (Array.isArray(params)) {
    return (statement as SqliteStatement<unknown[]>).run(...params);
  }

  return (statement as SqliteStatement<Record<string, PrimitiveSqlParam>>).run(params);
}
