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
  auth_mode TEXT NOT NULL DEFAULT 'oauth' CHECK (auth_mode IN ('oauth', 'none')),
  oauth_client_id TEXT,
  oauth_client_secret TEXT,
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
  scopes TEXT,
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
  client_id TEXT,
  client_secret TEXT,
  oauth_metadata TEXT,
  protected_resource_url TEXT,
  authorization_server_url TEXT,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_expires
ON oauth_state(expires_at);

CREATE TABLE IF NOT EXISTS mcp_capabilities (
  id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL UNIQUE,
  tools TEXT NOT NULL,
  resources TEXT NOT NULL,
  prompts TEXT,
  last_discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_capabilities_server
ON mcp_capabilities(mcp_server_id);

CREATE TABLE IF NOT EXISTS mcp_execution_history (
  id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('tool_execute', 'resource_read')),
  target_type TEXT NOT NULL CHECK (target_type IN ('tool', 'resource')),
  target_value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  request_summary TEXT,
  request_payload TEXT,
  response_content_type TEXT,
  response_payload TEXT,
  error_code TEXT,
  error_category TEXT,
  error_message TEXT,
  error_details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_history_server_created
ON mcp_execution_history(mcp_server_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_execution_history_server_action_created
ON mcp_execution_history(mcp_server_id, action_type, created_at DESC, id DESC);
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

function ensureOAuthStateColumns(db: SqliteDatabase) {
  const tableInfo = db
    .prepare("PRAGMA table_info(oauth_state)")
    .all() as Array<{ name: string }>;
  const existingColumns = new Set(tableInfo.map((column) => column.name));

  const requiredColumns = [
    "client_id TEXT",
    "client_secret TEXT",
    "oauth_metadata TEXT",
    "protected_resource_url TEXT",
    "authorization_server_url TEXT",
  ];

  for (const columnDefinition of requiredColumns) {
    const [columnName] = columnDefinition.split(" ");
    if (!columnName || existingColumns.has(columnName)) {
      continue;
    }

    db.exec(`ALTER TABLE oauth_state ADD COLUMN ${columnDefinition}`);
  }
}

function ensureOAuthCredentialColumns(db: SqliteDatabase) {
  const tableInfo = db
    .prepare("PRAGMA table_info(oauth_credentials)")
    .all() as Array<{ name: string }>;
  const existingColumns = new Set(tableInfo.map((column) => column.name));

  const requiredColumns = ["scopes TEXT"];

  for (const columnDefinition of requiredColumns) {
    const [columnName] = columnDefinition.split(" ");
    if (!columnName || existingColumns.has(columnName)) {
      continue;
    }

    db.exec(`ALTER TABLE oauth_credentials ADD COLUMN ${columnDefinition}`);
  }
}

function ensureAuthModeColumn(db: SqliteDatabase) {
  const tableInfo = db
    .prepare("PRAGMA table_info(mcp_servers)")
    .all() as Array<{ name: string }>;
  const existingColumns = new Set(tableInfo.map((column) => column.name));

  if (!existingColumns.has("auth_mode")) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'oauth'");
  }
}

function ensureOAuthClientColumns(db: SqliteDatabase) {
  const tableInfo = db
    .prepare("PRAGMA table_info(mcp_servers)")
    .all() as Array<{ name: string }>;
  const existingColumns = new Set(tableInfo.map((column) => column.name));

  if (!existingColumns.has("oauth_client_id")) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN oauth_client_id TEXT");
  }
  if (!existingColumns.has("oauth_client_secret")) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN oauth_client_secret TEXT");
  }
}

function ensureCapabilitiesCacheTable(db: SqliteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_capabilities (
      id TEXT PRIMARY KEY,
      mcp_server_id TEXT NOT NULL UNIQUE,
      tools TEXT NOT NULL,
      resources TEXT NOT NULL,
      prompts TEXT,
      last_discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_capabilities_server
    ON mcp_capabilities(mcp_server_id);
  `);
}

function ensureExecutionHistoryTable(db: SqliteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_execution_history (
      id TEXT PRIMARY KEY,
      mcp_server_id TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('tool_execute', 'resource_read')),
      target_type TEXT NOT NULL CHECK (target_type IN ('tool', 'resource')),
      target_value TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'error')),
      latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
      request_summary TEXT,
      request_payload TEXT,
      response_content_type TEXT,
      response_payload TEXT,
      error_code TEXT,
      error_category TEXT,
      error_message TEXT,
      error_details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_execution_history_server_created
    ON mcp_execution_history(mcp_server_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_execution_history_server_action_created
    ON mcp_execution_history(mcp_server_id, action_type, created_at DESC, id DESC);
  `);
}

export function getDb() {
  if (!globalThis.__mcpClientDb) {
    globalThis.__mcpClientDb = createDatabaseConnection();
  }

  return globalThis.__mcpClientDb;
}

export function initializeDatabase() {
  const db = getDb();

  if (!globalThis.__mcpClientDbInitialized) {
    db.exec(SCHEMA_SQL);
    globalThis.__mcpClientDbInitialized = true;
  }

  // Always run lightweight column checks so schema updates apply in long-lived dev sessions.
  ensureOAuthStateColumns(db);
  ensureOAuthCredentialColumns(db);
  ensureCapabilitiesCacheTable(db);
  ensureExecutionHistoryTable(db);
  ensureAuthModeColumn(db);
  ensureOAuthClientColumns(db);
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
