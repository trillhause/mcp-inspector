import { NextResponse } from "next/server";

import {
  createMcpClientByServerId,
  isMcpClientError,
  type McpTransportMode,
} from "@/lib/mcp/client";
import { bootstrapServerStore } from "@/lib/servers";

export const runtime = "nodejs";

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

function parseTransportOverride(request: Request) {
  const transport = new URL(request.url).searchParams.get("transport");
  if (!transport) {
    return null;
  }

  if (transport !== "streamable_http" && transport !== "sse") {
    throw new TypeError("transport must be one of: streamable_http, sse");
  }

  return transport as McpTransportMode;
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ serverId: string }>;
  },
) {
  bootstrapServerStore();
  const { serverId } = await context.params;

  let transportOverride: McpTransportMode | null = null;
  try {
    transportOverride = parseTransportOverride(request);
  } catch (error) {
    if (error instanceof TypeError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", [error.message]);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  try {
    const session = await createMcpClientByServerId({
      mcpServerId: serverId,
      ...(transportOverride ? { transport: transportOverride } : {}),
    });

    try {
      await session.client.ping();
      const serverVersion = session.client.getServerVersion();

      return NextResponse.json({
        mcp_server_id: serverId,
        status: "ok",
        configured_transport: session.connection.configured_transport,
        selected_transport: session.connection.selected_transport,
        transport_candidates: session.connection.transport_candidates,
        token_expires_at: session.connection.token_expires_at,
        server_version: serverVersion ?? null,
      });
    } finally {
      await session.close().catch(() => undefined);
    }
  } catch (error) {
    if (isMcpClientError(error)) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to establish MCP session");
  }
}
