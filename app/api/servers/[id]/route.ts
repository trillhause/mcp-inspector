import { NextResponse } from "next/server";

import { dbExecute, dbQueryFirst } from "@/lib/db";
import {
  bootstrapServerStore,
  isServerTransport,
  mapServerRowToMcpServer,
  PayloadValidationError,
  type ServerRow,
  type ServerTransport,
} from "@/lib/servers";

export const runtime = "nodejs";

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

function getServerById(serverId: string) {
  return dbQueryFirst<ServerRow>(`${SERVER_SELECT_SQL} WHERE s.id = ? LIMIT 1`, [serverId]);
}

type UpdateServerPayload = {
  name?: string;
  description?: string | null;
  transport?: ServerTransport;
  is_enabled?: boolean;
};

function validateUpdatePayload(payload: Record<string, unknown>) {
  const issues: string[] = [];
  const updates: UpdateServerPayload = {};

  if ("name" in payload) {
    if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
      issues.push("name must be a non-empty string");
    } else {
      updates.name = payload.name.trim();
    }
  }

  if ("description" in payload) {
    if (payload.description === null) {
      updates.description = null;
    } else if (typeof payload.description === "string") {
      updates.description = payload.description.trim() || null;
    } else {
      issues.push("description must be a string or null");
    }
  }

  if ("mcp_url" in payload) {
    issues.push("mcp_url is immutable and cannot be updated");
  }

  if ("transport" in payload) {
    if (!isServerTransport(payload.transport)) {
      issues.push("transport must be one of: auto, streamable_http, sse");
    } else {
      updates.transport = payload.transport;
    }
  }

  if ("is_enabled" in payload) {
    if (typeof payload.is_enabled !== "boolean") {
      issues.push("is_enabled must be a boolean");
    } else {
      updates.is_enabled = payload.is_enabled;
    }
  }

  if (Object.keys(updates).length === 0) {
    issues.push(
      "At least one editable field is required: name, description, transport, is_enabled",
    );
  }

  if (issues.length > 0) {
    throw new PayloadValidationError(issues);
  }

  return updates;
}

function buildUpdateStatement(serverId: string, updates: UpdateServerPayload) {
  const clauses: string[] = [];
  const params: Record<string, string | number | null> = { id: serverId };

  if (updates.name !== undefined) {
    clauses.push("name = @name");
    params.name = updates.name;
  }

  if (updates.description !== undefined) {
    clauses.push("description = @description");
    params.description = updates.description;
  }

  if (updates.transport !== undefined) {
    clauses.push("transport = @transport");
    params.transport = updates.transport;
  }

  if (updates.is_enabled !== undefined) {
    clauses.push("is_enabled = @is_enabled");
    params.is_enabled = updates.is_enabled ? 1 : 0;
  }

  clauses.push("updated_at = datetime('now')");

  return {
    sql: `UPDATE mcp_servers SET ${clauses.join(", ")} WHERE id = @id`,
    params,
  };
}

function validatePreconfiguredGuardrails(
  server: Pick<ServerRow, "is_preconfigured">,
  updates: UpdateServerPayload,
) {
  if (server.is_preconfigured !== 1) {
    return;
  }

  const disallowedFields: string[] = [];
  if (updates.name !== undefined) {
    disallowedFields.push("name");
  }
  if (updates.description !== undefined) {
    disallowedFields.push("description");
  }

  if (disallowedFields.length > 0) {
    throw new PayloadValidationError([
      `Pre-configured servers have read-only fields: ${disallowedFields.join(", ")}.`,
      "Only transport and enabled state can be updated for pre-configured servers.",
    ]);
  }
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  bootstrapServerStore();
  const { id } = await context.params;

  const server = getServerById(id);
  if (!server) {
    return errorResponse(404, "NOT_FOUND", "Server not found");
  }

  return NextResponse.json({ server: mapServerRowToMcpServer(server) });
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  bootstrapServerStore();
  const { id } = await context.params;

  const existingServer = dbQueryFirst<Pick<ServerRow, "id" | "is_preconfigured">>(
    "SELECT id, is_preconfigured FROM mcp_servers WHERE id = ? LIMIT 1",
    [id],
  );
  if (!existingServer) {
    return errorResponse(404, "NOT_FOUND", "Server not found");
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonObject(request);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  let updates: UpdateServerPayload;
  try {
    updates = validateUpdatePayload(payload);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  try {
    validatePreconfiguredGuardrails(existingServer, updates);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(403, "FORBIDDEN", "Requested update is not allowed", error.issues);
    }
    return errorResponse(403, "FORBIDDEN", "Requested update is not allowed");
  }

  try {
    const { sql, params } = buildUpdateStatement(id, updates);
    dbExecute(sql, params);
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to update server");
  }

  const updatedServer = getServerById(id);
  if (!updatedServer) {
    return errorResponse(500, "INTERNAL_ERROR", "Server was updated but could not be loaded");
  }

  return NextResponse.json({ server: mapServerRowToMcpServer(updatedServer) });
}

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  bootstrapServerStore();
  const { id } = await context.params;

  const existingServer = dbQueryFirst<{ id: string; is_preconfigured: number }>(
    "SELECT id, is_preconfigured FROM mcp_servers WHERE id = ? LIMIT 1",
    [id],
  );
  if (!existingServer) {
    return errorResponse(404, "NOT_FOUND", "Server not found");
  }

  if (existingServer.is_preconfigured === 1) {
    return errorResponse(
      403,
      "FORBIDDEN",
      "Pre-configured servers cannot be deleted. Disable instead via PATCH is_enabled=false.",
    );
  }

  dbExecute("DELETE FROM mcp_servers WHERE id = ?", [id]);

  return NextResponse.json({ deleted: true });
}
