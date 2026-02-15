import { NextResponse } from "next/server";

import { dbQueryFirst } from "@/lib/db";
import {
  ExecutionHistoryCursorError,
  listExecutionHistoryForServer,
} from "@/lib/mcp/execution-history";
import {
  MCP_INTERACTION_ERROR_CATEGORY_BY_CODE,
  type McpInteractionErrorCode,
} from "@/lib/mcp/interaction-contract";
import { bootstrapServerStore, PayloadValidationError } from "@/lib/servers";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function errorResponse(
  status: number,
  code: McpInteractionErrorCode,
  message: string,
  details?: string[],
) {
  return NextResponse.json(
    {
      error: {
        code,
        category: MCP_INTERACTION_ERROR_CATEGORY_BY_CODE[code],
        message,
        ...(details && details.length > 0 ? { details } : {}),
      },
    },
    { status },
  );
}

function normalizeServerId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new PayloadValidationError(["serverId route parameter is required"]);
  }

  return trimmed;
}

function parseLimit(rawLimit: string | null) {
  if (!rawLimit) {
    return DEFAULT_LIMIT;
  }

  if (!/^\d+$/.test(rawLimit)) {
    throw new PayloadValidationError(["limit must be a positive integer"]);
  }

  const parsedLimit = Number(rawLimit);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    throw new PayloadValidationError(["limit must be a positive integer"]);
  }

  return Math.min(MAX_LIMIT, Math.trunc(parsedLimit));
}

function serverExists(serverId: string) {
  const row = dbQueryFirst<{ id: string }>("SELECT id FROM mcp_servers WHERE id = ? LIMIT 1", [
    serverId,
  ]);
  return Boolean(row);
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ serverId: string }>;
  },
) {
  bootstrapServerStore();

  let serverId: string;
  try {
    const params = await context.params;
    serverId = normalizeServerId(params.serverId);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  if (!serverExists(serverId)) {
    return errorResponse(404, "INVALID_REQUEST", "Server was not found");
  }

  const { searchParams } = new URL(request.url);

  try {
    const limit = parseLimit(searchParams.get("limit"));
    const cursor = searchParams.get("cursor");
    const history = listExecutionHistoryForServer({
      mcpServerId: serverId,
      limit,
      cursor,
    });

    return NextResponse.json({
      mcp_server_id: serverId,
      limit,
      has_more: Boolean(history.nextCursor),
      next_cursor: history.nextCursor,
      items: history.items,
    });
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    if (error instanceof ExecutionHistoryCursorError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", [error.message]);
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to load execution history");
  }
}
