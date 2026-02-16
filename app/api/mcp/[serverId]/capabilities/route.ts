import { NextResponse } from "next/server";

import { dbQueryFirst } from "@/lib/db";
import {
  readCachedCapabilities,
  upsertDiscoveredCapabilities,
  type CachedCapabilitiesRecord,
} from "@/lib/mcp/capabilities-store";
import {
  discoverCapabilities,
  isMcpCapabilityDiscoveryError,
} from "@/lib/mcp/discovery";
import { isMcpClientError } from "@/lib/mcp/client";
import { bootstrapServerStore } from "@/lib/servers";

export const runtime = "nodejs";

type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: string[];
};

function errorResponse(error: ApiError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && error.details.length > 0 ? { details: error.details } : {}),
      },
    },
    { status: error.status },
  );
}

function parseBooleanFlag(value: string | null, fieldName: string) {
  if (value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }

  throw new TypeError(`${fieldName} must be one of: 1, 0, true, false`);
}

function parseRefreshMode(request: Request) {
  const requestUrl = new URL(request.url);
  const refreshFromQuery = parseBooleanFlag(requestUrl.searchParams.get("refresh"), "refresh");
  if (refreshFromQuery !== null) {
    return refreshFromQuery;
  }

  const refreshFromHeader = parseBooleanFlag(
    request.headers.get("x-mcp-capabilities-refresh"),
    "x-mcp-capabilities-refresh",
  );
  if (refreshFromHeader !== null) {
    return refreshFromHeader;
  }

  return false;
}

function mapInternalError(error: unknown): ApiError {
  if (isMcpCapabilityDiscoveryError(error)) {
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (isMcpClientError(error)) {
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Failed to discover MCP capabilities",
  };
}

function toCapabilitiesPayload(record: CachedCapabilitiesRecord, cached: boolean) {
  const prompts = record.prompts ?? [];

  return {
    mcp_server_id: record.mcp_server_id,
    tools: record.tools,
    resources: record.resources,
    prompts,
    tools_count: record.tools.length,
    resources_count: record.resources.length,
    prompts_count: prompts.length,
    cached,
    last_discovered_at: record.last_discovered_at,
  };
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ serverId: string }>;
  },
) {
  bootstrapServerStore();
  const { serverId } = await context.params;

  let refreshRequested = false;
  try {
    refreshRequested = parseRefreshMode(request);
  } catch (error) {
    if (error instanceof TypeError) {
      return errorResponse({
        status: 400,
        code: "INVALID_REQUEST",
        message: "Request validation failed",
        details: [error.message],
      });
    }

    return errorResponse({
      status: 400,
      code: "INVALID_REQUEST",
      message: "Request validation failed",
    });
  }

  const server = dbQueryFirst<{ id: string }>("SELECT id FROM mcp_servers WHERE id = ? LIMIT 1", [
    serverId,
  ]);
  if (!server) {
    return errorResponse({
      status: 404,
      code: "NOT_FOUND",
      message: "Server not found",
    });
  }

  const cachedRecord = readCachedCapabilities(serverId);

  if (!refreshRequested && cachedRecord) {
    return NextResponse.json(toCapabilitiesPayload(cachedRecord, true));
  }

  try {
    const discovered = await discoverCapabilities(serverId);
    const persisted = upsertDiscoveredCapabilities(discovered);
    return NextResponse.json(toCapabilitiesPayload(persisted, false));
  } catch (error) {
    const mappedError = mapInternalError(error);

    if (cachedRecord) {
      return NextResponse.json({
        ...toCapabilitiesPayload(cachedRecord, true),
        error: {
          code: mappedError.code,
          message: mappedError.message,
          ...(mappedError.details && mappedError.details.length > 0
            ? { details: mappedError.details }
            : {}),
          stale: true,
        },
      });
    }

    return errorResponse(mappedError);
  }
}
