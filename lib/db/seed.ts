import "server-only";

import { PRECONFIGURED_SERVERS } from "@/lib/data/preconfigured-servers";
import { getDb } from "@/lib/db";

type SeedRow = {
  id: string;
  name: string;
  description: string;
  mcp_url: string;
  transport: "auto" | "streamable_http" | "sse";
  icon_url: string;
  is_enabled: number;
};

declare global {
  var __mcpClientPreconfiguredSeeded: boolean | undefined;
}

function buildSeedRows(): SeedRow[] {
  return PRECONFIGURED_SERVERS.map((server) => ({
    id: server.id,
    name: server.name,
    description: server.description,
    mcp_url: server.mcp_url,
    transport: server.transport,
    icon_url: server.icon_url,
    is_enabled: server.is_enabled ? 1 : 0,
  }));
}

export function seedPreconfiguredServers() {
  if (globalThis.__mcpClientPreconfiguredSeeded) {
    return;
  }

  const db = getDb();
  const seedRows = buildSeedRows();

  const upsertServer = db.prepare(`
    INSERT INTO mcp_servers (
      id,
      name,
      description,
      mcp_url,
      transport,
      icon_url,
      is_preconfigured,
      is_enabled
    )
    VALUES (
      @id,
      @name,
      @description,
      @mcp_url,
      @transport,
      @icon_url,
      1,
      @is_enabled
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      mcp_url = excluded.mcp_url,
      transport = excluded.transport,
      icon_url = excluded.icon_url,
      is_preconfigured = 1,
      is_enabled = excluded.is_enabled,
      updated_at = datetime('now')
  `);

  const runSeed = db.transaction((rows: SeedRow[]) => {
    for (const row of rows) {
      upsertServer.run(row);
    }
  });

  runSeed(seedRows);
  globalThis.__mcpClientPreconfiguredSeeded = true;
}
