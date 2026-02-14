import "server-only";

import { randomUUID } from "node:crypto";

import { dbExecute, dbQueryFirst } from "@/lib/db";
import type {
  DiscoveredCapabilities,
  DiscoveredPrompt,
  DiscoveredResource,
  DiscoveredTool,
} from "@/lib/mcp/discovery";

type CapabilitiesRow = {
  mcp_server_id: string;
  tools: string;
  resources: string;
  prompts: string | null;
  last_discovered_at: string;
};

export type CachedCapabilitiesRecord = {
  mcp_server_id: string;
  tools: DiscoveredTool[];
  resources: DiscoveredResource[];
  prompts: DiscoveredPrompt[] | null;
  last_discovered_at: string;
};

function parseJsonArray<T>(value: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function mapCapabilitiesRow(row: CapabilitiesRow): CachedCapabilitiesRecord {
  return {
    mcp_server_id: row.mcp_server_id,
    tools: parseJsonArray<DiscoveredTool>(row.tools, []),
    resources: parseJsonArray<DiscoveredResource>(row.resources, []),
    prompts: row.prompts ? parseJsonArray<DiscoveredPrompt>(row.prompts, []) : null,
    last_discovered_at: row.last_discovered_at,
  };
}

export function readCachedCapabilities(mcpServerId: string): CachedCapabilitiesRecord | null {
  const row = dbQueryFirst<CapabilitiesRow>(
    `SELECT
      mcp_server_id,
      tools,
      resources,
      prompts,
      last_discovered_at
    FROM mcp_capabilities
    WHERE mcp_server_id = ?
    LIMIT 1`,
    [mcpServerId],
  );

  if (!row) {
    return null;
  }

  return mapCapabilitiesRow(row);
}

export function upsertDiscoveredCapabilities(
  discovery: DiscoveredCapabilities,
): CachedCapabilitiesRecord {
  const prompts = discovery.prompts ?? null;
  const lastDiscoveredAt = discovery.discovered_at;
  const id = randomUUID();

  dbExecute(
    `INSERT INTO mcp_capabilities (
      id,
      mcp_server_id,
      tools,
      resources,
      prompts,
      last_discovered_at
    ) VALUES (
      @id,
      @mcp_server_id,
      @tools,
      @resources,
      @prompts,
      @last_discovered_at
    )
    ON CONFLICT(mcp_server_id) DO UPDATE SET
      tools = excluded.tools,
      resources = excluded.resources,
      prompts = excluded.prompts,
      last_discovered_at = excluded.last_discovered_at`,
    {
      id,
      mcp_server_id: discovery.mcp_server_id,
      tools: JSON.stringify(discovery.tools),
      resources: JSON.stringify(discovery.resources),
      prompts: prompts ? JSON.stringify(prompts) : null,
      last_discovered_at: lastDiscoveredAt,
    },
  );

  return {
    mcp_server_id: discovery.mcp_server_id,
    tools: discovery.tools,
    resources: discovery.resources,
    prompts,
    last_discovered_at: lastDiscoveredAt,
  };
}
