import { NextResponse } from "next/server";

import { dbQueryFirst } from "@/lib/db";
import { deriveMcpTokenLifecycleState } from "@/lib/mcp/interaction-contract";
import { OAuthRefreshError, refreshOAuthCredential } from "@/lib/oauth/refresh";
import { bootstrapServerStore, PayloadValidationError } from "@/lib/servers";

export const runtime = "nodejs";

type RefreshRequestPayload = {
  mcp_server_id?: unknown;
  force?: unknown;
};

type ValidatedRefreshPayload = {
  mcpServerId: string;
  force: boolean;
};

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

async function readJsonObject(request: Request): Promise<RefreshRequestPayload> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new PayloadValidationError(["Request body must be valid JSON"]);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PayloadValidationError(["Request body must be a JSON object"]);
  }

  return payload as RefreshRequestPayload;
}

function validateRefreshPayload(payload: RefreshRequestPayload): ValidatedRefreshPayload {
  const issues: string[] = [];

  const mcpServerId =
    typeof payload.mcp_server_id === "string" ? payload.mcp_server_id.trim() : "";
  if (!mcpServerId) {
    issues.push("mcp_server_id is required");
  }

  let force = false;
  if (payload.force !== undefined) {
    if (typeof payload.force !== "boolean") {
      issues.push("force must be a boolean when provided");
    } else {
      force = payload.force;
    }
  }

  if (issues.length > 0) {
    throw new PayloadValidationError(issues);
  }

  return {
    mcpServerId,
    force,
  };
}

export async function POST(request: Request) {
  bootstrapServerStore();

  let payload: RefreshRequestPayload;
  try {
    payload = await readJsonObject(request);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  let validatedPayload: ValidatedRefreshPayload;
  try {
    validatedPayload = validateRefreshPayload(payload);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  const server = dbQueryFirst<{ id: string }>("SELECT id FROM mcp_servers WHERE id = ? LIMIT 1", [
    validatedPayload.mcpServerId,
  ]);
  if (!server) {
    return errorResponse(404, "NOT_FOUND", "Server not found");
  }

  try {
    const result = await refreshOAuthCredential({
      mcpServerId: validatedPayload.mcpServerId,
      force: validatedPayload.force,
    });
    const tokenLifecycleState = deriveMcpTokenLifecycleState(result.token_expires_at);
    const connectionStatus =
      result.status === "reconnect_required" || tokenLifecycleState === "expired"
        ? "expired"
        : "connected";

    return NextResponse.json({
      mcp_server_id: result.mcp_server_id,
      status: result.status,
      connection_status: connectionStatus,
      refreshed: result.refreshed,
      refresh_reason: result.refresh_reason,
      connected_at: result.connected_at,
      token_expires_at: result.token_expires_at,
      token_lifecycle_state: tokenLifecycleState,
      last_refreshed_at: result.last_refreshed_at,
    });
  } catch (error) {
    if (error instanceof OAuthRefreshError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to refresh OAuth credentials");
  }
}
