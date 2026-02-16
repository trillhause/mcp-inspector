import "server-only";

import type { McpServer } from "@/lib/types";
import { initializeDatabase } from "@/lib/db";
import { seedPreconfiguredServers } from "@/lib/db/seed";

export const ALLOWED_TRANSPORTS = ["auto", "streamable_http", "sse"] as const;
export type ServerTransport = (typeof ALLOWED_TRANSPORTS)[number];

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export class PayloadValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "Request payload is invalid");
    this.name = "PayloadValidationError";
    this.issues = issues;
  }
}

export type CanonicalMcpUrl = {
  canonicalUrl: string;
  origin: string;
  protectedResourceDiscoveryUrl: string;
};

export type ServerRow = {
  id: string;
  name: string;
  description: string | null;
  mcp_url: string;
  transport: ServerTransport;
  icon_url: string | null;
  is_preconfigured: number;
  is_enabled: number;
  token_expires_at: string | null;
  oauth_connected_at: string | null;
};

export function bootstrapServerStore() {
  initializeDatabase();
  seedPreconfiguredServers();
}

export function isServerTransport(value: unknown): value is ServerTransport {
  return typeof value === "string" && ALLOWED_TRANSPORTS.includes(value as ServerTransport);
}

export function getTransportPreferenceOrder(transport: ServerTransport) {
  if (transport === "auto") {
    return ["streamable_http", "sse"] as const;
  }

  return [transport] as const;
}

function normalizePathname(pathname: string) {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  if (withoutTrailingSlash.length === 0 || withoutTrailingSlash === "/") {
    return "/mcp";
  }
  return withoutTrailingSlash.startsWith("/") ? withoutTrailingSlash : `/${withoutTrailingSlash}`;
}

function isAllowedHttpHostname(hostname: string) {
  if (LOCALHOST_HOSTNAMES.has(hostname)) {
    return true;
  }
  return hostname.endsWith(".localhost");
}

export function canonicalizeMcpUrl(input: string): CanonicalMcpUrl {
  const rawValue = input.trim();
  if (!rawValue) {
    throw new PayloadValidationError(["mcp_url is required"]);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawValue);
  } catch {
    throw new PayloadValidationError(["mcp_url must be a valid absolute URL"]);
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    throw new PayloadValidationError(["mcp_url must use https:// (or http:// for localhost)"]);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (protocol !== "https:" && !isAllowedHttpHostname(hostname)) {
    throw new PayloadValidationError(["mcp_url must use https:// for non-localhost URLs"]);
  }

  const normalizedPathname = normalizePathname(parsedUrl.pathname);
  const canonicalUrl = `${parsedUrl.origin}${normalizedPathname}`;

  return {
    canonicalUrl,
    origin: parsedUrl.origin,
    protectedResourceDiscoveryUrl: new URL(
      "/.well-known/oauth-protected-resource",
      parsedUrl.origin,
    ).toString(),
  };
}

export function findCanonicalUrlConflict(
  existingRows: Array<{ id: string; mcp_url: string }>,
  canonicalUrl: string,
  excludeServerId?: string,
) {
  for (const row of existingRows) {
    if (excludeServerId && row.id === excludeServerId) {
      continue;
    }

    try {
      const existingCanonical = canonicalizeMcpUrl(row.mcp_url).canonicalUrl;
      if (existingCanonical === canonicalUrl) {
        return row.id;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getConnectionStatus(row: ServerRow): McpServer["connection_status"] {
  if (!row.oauth_connected_at) {
    return "disconnected";
  }

  if (row.token_expires_at) {
    const expiresAtMs = Date.parse(row.token_expires_at);
    if (!Number.isNaN(expiresAtMs) && expiresAtMs <= Date.now()) {
      return "expired";
    }
  }

  return "connected";
}

export function mapServerRowToMcpServer(row: ServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    mcp_url: row.mcp_url,
    transport: row.transport,
    icon_url: row.icon_url ?? "/globe.svg",
    is_preconfigured: row.is_preconfigured === 1,
    is_enabled: row.is_enabled === 1,
    connection_status: getConnectionStatus(row),
    tool_count: null,
    resource_count: null,
    connected_at: row.oauth_connected_at,
  };
}
