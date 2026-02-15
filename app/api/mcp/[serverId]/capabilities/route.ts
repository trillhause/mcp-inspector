import { NextResponse } from "next/server";

import { dbQueryFirst } from "@/lib/db";
import {
  type CachedCapabilitiesRecord,
  readCachedCapabilities,
} from "@/lib/mcp/capabilities-store";
import {
  DEFAULT_CAPABILITIES_CACHE_TTL_MS,
  enqueueCapabilitiesRefresh,
  getCapabilitiesCacheAgeMs,
  refreshCapabilitiesForServer,
} from "@/lib/mcp/capabilities-refresh";
import { isMcpClientError } from "@/lib/mcp/client";
import { isMcpCapabilityDiscoveryError } from "@/lib/mcp/discovery";
import {
  deriveMcpTokenLifecycleState,
  MCP_INTERACTION_ERROR_CATEGORY_BY_CODE,
  type McpInteractionErrorCode,
} from "@/lib/mcp/interaction-contract";
import { bootstrapServerStore } from "@/lib/servers";

export const runtime = "nodejs";

const CAPABILITIES_CACHE_TTL_MS = DEFAULT_CAPABILITIES_CACHE_TTL_MS;

type ConnectionStatus = "connected" | "expired" | "disconnected";
type StaleReason =
  | "cache_stale_ttl"
  | "reconnect_required"
  | "disconnected"
  | "refresh_failed";

type ServerConnectionRow = {
  id: string;
  auth_mode: "oauth" | "none";
  token_expires_at: string | null;
  has_credentials: number;
};

type ApiError = {
  status: number;
  code: McpInteractionErrorCode;
  message: string;
  details?: string[];
};

function errorResponse(error: ApiError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        category: MCP_INTERACTION_ERROR_CATEGORY_BY_CODE[error.code],
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

function hasReconnectRequiredDetail(details: string[] | undefined) {
  if (!details || details.length === 0) {
    return false;
  }

  return details.some((detail) => detail.toLowerCase().includes("reconnect_required=true"));
}

function mapInternalError(error: unknown): ApiError {
  if (isMcpCapabilityDiscoveryError(error)) {
    return {
      status: error.httpStatus,
      code: "EXECUTION_FAILED",
      message: error.message,
      details: [
        ...(error.details ?? []),
        `upstream_error_code=${error.code}`,
      ],
    };
  }

  if (isMcpClientError(error)) {
    const normalizedCode: McpInteractionErrorCode =
      error.code === "AUTH_REQUIRED" && hasReconnectRequiredDetail(error.details)
        ? "RECONNECT_REQUIRED"
        : error.code === "NOT_CONNECTED" ||
            error.code === "AUTH_REQUIRED" ||
            error.code === "MCP_CONNECT_FAILED"
          ? error.code
          : "INTERNAL_ERROR";
    return {
      status: error.httpStatus,
      code: normalizedCode,
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

function resolveConnectionStatus(
  row: Pick<ServerConnectionRow, "auth_mode" | "token_expires_at" | "has_credentials">,
): ConnectionStatus {
  if (row.auth_mode === "none") {
    return "connected";
  }

  if (row.has_credentials !== 1) {
    return "disconnected";
  }

  if (deriveMcpTokenLifecycleState(row.token_expires_at) === "expired") {
    return "expired";
  }

  return "connected";
}

function buildStaleMessage(reason: StaleReason) {
  if (reason === "cache_stale_ttl") {
    return "Capabilities cache is stale and may be out-of-date.";
  }

  if (reason === "reconnect_required") {
    return "Credentials appear expired. Reconnect this server to refresh capabilities.";
  }

  if (reason === "disconnected") {
    return "Server is disconnected. Showing last known capabilities.";
  }

  return "Capabilities refresh failed. Showing last known capabilities.";
}

function toCapabilitiesPayload(
  record: CachedCapabilitiesRecord,
  options: {
    cached: boolean;
    staleReason?: StaleReason;
    staleMessage?: string;
    backgroundRefreshScheduled?: boolean;
    ageMs?: number | null;
  },
) {
  const prompts = record.prompts ?? [];
  const staleReason = options.staleReason ?? null;
  const staleMessage = options.staleMessage ?? (staleReason ? buildStaleMessage(staleReason) : null);
  const stale = staleReason !== null;
  const ageMs =
    options.ageMs === undefined ? getCapabilitiesCacheAgeMs(record.last_discovered_at) : options.ageMs;

  return {
    mcp_server_id: record.mcp_server_id,
    tools: record.tools,
    resources: record.resources,
    prompts,
    tools_count: record.tools.length,
    resources_count: record.resources.length,
    prompts_count: prompts.length,
    cached: options.cached,
    last_discovered_at: record.last_discovered_at,
    stale,
    stale_reason: staleReason,
    stale_message: staleMessage,
    cache_age_ms: ageMs,
    cache_ttl_ms: CAPABILITIES_CACHE_TTL_MS,
    background_refresh_scheduled: options.backgroundRefreshScheduled === true,
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
      code: "NOT_CONNECTED",
      message: "Server not found",
    });
  }

  const connection = dbQueryFirst<ServerConnectionRow>(
    `SELECT
      s.id,
      s.auth_mode AS auth_mode,
      c.token_expires_at AS token_expires_at,
      CASE WHEN c.mcp_server_id IS NULL THEN 0 ELSE 1 END AS has_credentials
    FROM mcp_servers s
    LEFT JOIN oauth_credentials c
      ON c.mcp_server_id = s.id
    WHERE s.id = ?
    LIMIT 1`,
    [serverId],
  );
  if (!connection) {
    return errorResponse({
      status: 404,
      code: "NOT_CONNECTED",
      message: "Server not found",
    });
  }

  const connectionStatus = resolveConnectionStatus(connection);
  const cachedRecord = readCachedCapabilities(serverId);

  if (!refreshRequested && cachedRecord) {
    const cacheAgeMs = getCapabilitiesCacheAgeMs(cachedRecord.last_discovered_at);
    const staleByTtl = cacheAgeMs === null || cacheAgeMs > CAPABILITIES_CACHE_TTL_MS;

    if (connectionStatus === "expired") {
      return NextResponse.json(
        toCapabilitiesPayload(cachedRecord, {
          cached: true,
          staleReason: "reconnect_required",
          ageMs: cacheAgeMs,
        }),
      );
    }

    if (connectionStatus === "disconnected") {
      return NextResponse.json(
        toCapabilitiesPayload(cachedRecord, {
          cached: true,
          staleReason: "disconnected",
          ageMs: cacheAgeMs,
        }),
      );
    }

    if (staleByTtl) {
      enqueueCapabilitiesRefresh({
        mcpServerId: serverId,
        reason: "cache_stale_ttl",
      });

      return NextResponse.json(
        toCapabilitiesPayload(cachedRecord, {
          cached: true,
          staleReason: "cache_stale_ttl",
          ageMs: cacheAgeMs,
          backgroundRefreshScheduled: true,
        }),
      );
    }

    return NextResponse.json(
      toCapabilitiesPayload(cachedRecord, {
        cached: true,
        ageMs: cacheAgeMs,
      }),
    );
  }

  if (connectionStatus === "expired" && !cachedRecord) {
    return errorResponse({
      status: 401,
      code: "RECONNECT_REQUIRED",
      message: "Credentials are expired and require reconnect before refreshing capabilities",
      details: ["reconnect_required=true"],
    });
  }

  if (connectionStatus === "disconnected" && !cachedRecord) {
    return errorResponse({
      status: 409,
      code: "NOT_CONNECTED",
      message: "Server is not connected",
    });
  }

  try {
    const persisted = await refreshCapabilitiesForServer({
      mcpServerId: serverId,
      reason: refreshRequested
        ? "manual_refresh"
        : cachedRecord
          ? "cache_stale_ttl"
          : "cache_miss",
    });

    return NextResponse.json(
      toCapabilitiesPayload(persisted, {
        cached: false,
      }),
    );
  } catch (error) {
    const mappedError = mapInternalError(error);

    if (cachedRecord) {
      const fallbackReason: StaleReason =
        connectionStatus === "expired" || mappedError.code === "RECONNECT_REQUIRED"
          ? "reconnect_required"
          : "refresh_failed";

      return NextResponse.json({
        ...toCapabilitiesPayload(cachedRecord, {
          cached: true,
          staleReason: fallbackReason,
        }),
        error: {
          code: mappedError.code,
          category: MCP_INTERACTION_ERROR_CATEGORY_BY_CODE[mappedError.code],
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
