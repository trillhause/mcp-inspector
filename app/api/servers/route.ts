import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { dbExecute, dbQueryAll, dbQueryFirst } from "@/lib/db";
import {
  bootstrapServerStore,
  canonicalizeMcpUrl,
  findCanonicalUrlConflict,
  isServerTransport,
  mapServerRowToMcpServer,
  PayloadValidationError,
  type ServerRow,
  type ServerTransport,
} from "@/lib/servers";

export const runtime = "nodejs";

const DEFAULT_CUSTOM_ICON_URL = "/globe.svg";

const SERVER_SELECT_SQL = `
SELECT
  s.id,
  s.name,
  s.description,
  s.mcp_url,
  s.transport,
  s.icon_url,
  s.is_preconfigured,
  s.is_enabled,
  s.auth_mode,
  c.token_expires_at AS token_expires_at,
  c.connected_at AS oauth_connected_at
FROM mcp_servers s
LEFT JOIN oauth_credentials c
  ON c.mcp_server_id = s.id
`;

function errorResponse(status: number, code: string, message: string, details?: string[]) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details && details.length > 0 ? { details } : {}),
      },
    },
    { status },
  );
}

async function readJsonObject(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new PayloadValidationError(["Request body must be valid JSON"]);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PayloadValidationError(["Request body must be a JSON object"]);
  }

  return payload as Record<string, unknown>;
}

type CreateServerPayload = {
  name: string;
  description: string | null;
  canonicalMcpUrl: string;
  transport: ServerTransport;
};

function validateCreatePayload(payload: Record<string, unknown>): CreateServerPayload {
  const issues: string[] = [];

  const rawName = payload.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) {
    issues.push("name is required");
  }

  let description: string | null = null;
  if (payload.description === undefined || payload.description === null) {
    description = null;
  } else if (typeof payload.description === "string") {
    description = payload.description.trim() || null;
  } else {
    issues.push("description must be a string when provided");
  }

  const rawTransport = payload.transport;
  let transport: ServerTransport = "auto";
  if (rawTransport === undefined) {
    transport = "auto";
  } else if (isServerTransport(rawTransport)) {
    transport = rawTransport;
  } else {
    issues.push("transport must be one of: auto, streamable_http, sse");
  }

  let canonicalMcpUrl = "";
  if (typeof payload.mcp_url !== "string") {
    issues.push("mcp_url is required");
  } else {
    try {
      canonicalMcpUrl = canonicalizeMcpUrl(payload.mcp_url).canonicalUrl;
    } catch (error) {
      if (error instanceof PayloadValidationError) {
        issues.push(...error.issues);
      } else {
        issues.push("mcp_url is invalid");
      }
    }
  }

  if (issues.length > 0) {
    throw new PayloadValidationError(issues);
  }

  return {
    name,
    description,
    canonicalMcpUrl,
    transport,
  };
}

function getServerById(serverId: string) {
  return dbQueryFirst<ServerRow>(`${SERVER_SELECT_SQL} WHERE s.id = ? LIMIT 1`, [serverId]);
}

export async function GET() {
  bootstrapServerStore();

  const rows = dbQueryAll<ServerRow>(
    `${SERVER_SELECT_SQL}
     ORDER BY s.is_enabled DESC, s.is_preconfigured DESC, LOWER(s.name) ASC, s.id ASC`,
  );

  return NextResponse.json({
    servers: rows.map(mapServerRowToMcpServer),
  });
}

export async function POST(request: Request) {
  bootstrapServerStore();

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonObject(request);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  let validatedPayload: CreateServerPayload;
  try {
    validatedPayload = validateCreatePayload(payload);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  const existingRows = dbQueryAll<{ id: string; mcp_url: string }>(
    "SELECT id, mcp_url FROM mcp_servers",
  );
  const conflictingServerId = findCanonicalUrlConflict(
    existingRows,
    validatedPayload.canonicalMcpUrl,
  );

  if (conflictingServerId) {
    return errorResponse(
      409,
      "SERVER_ALREADY_EXISTS",
      "A server with this canonical MCP URL already exists",
    );
  }

  const serverId = `custom-${randomUUID()}`;

  try {
    dbExecute(
      `INSERT INTO mcp_servers (
        id,
        name,
        description,
        mcp_url,
        transport,
        icon_url,
        is_preconfigured,
        is_enabled
      ) VALUES (
        @id,
        @name,
        @description,
        @mcp_url,
        @transport,
        @icon_url,
        0,
        1
      )`,
      {
        id: serverId,
        name: validatedPayload.name,
        description: validatedPayload.description,
        mcp_url: validatedPayload.canonicalMcpUrl,
        transport: validatedPayload.transport,
        icon_url: DEFAULT_CUSTOM_ICON_URL,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return errorResponse(
        409,
        "SERVER_ALREADY_EXISTS",
        "A server with this MCP URL already exists",
      );
    }
    return errorResponse(500, "INTERNAL_ERROR", "Failed to create server");
  }

  const createdServer = getServerById(serverId);
  if (!createdServer) {
    return errorResponse(500, "INTERNAL_ERROR", "Server was created but could not be loaded");
  }

  return NextResponse.json({ server: mapServerRowToMcpServer(createdServer) }, { status: 201 });
}
