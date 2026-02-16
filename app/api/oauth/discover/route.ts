import { NextResponse } from "next/server";

import { dbQueryFirst } from "@/lib/db";
import {
  discoverOAuthMetadata,
  isOAuthDiscoveryError,
} from "@/lib/oauth/discovery";
import { bootstrapServerStore, canonicalizeMcpUrl, PayloadValidationError } from "@/lib/servers";

export const runtime = "nodejs";

type DiscoverRequestPayload = {
  mcp_server_id?: unknown;
  mcp_url?: unknown;
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

async function readJsonObject(request: Request): Promise<DiscoverRequestPayload> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new PayloadValidationError(["Request body must be valid JSON"]);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PayloadValidationError(["Request body must be a JSON object"]);
  }

  return payload as DiscoverRequestPayload;
}

function resolveInputMcpUrl(payload: DiscoverRequestPayload) {
  const issues: string[] = [];
  const hasServerId = typeof payload.mcp_server_id === "string" && payload.mcp_server_id.trim().length > 0;
  const hasMcpUrl = typeof payload.mcp_url === "string" && payload.mcp_url.trim().length > 0;

  if (!hasServerId && !hasMcpUrl) {
    issues.push("Provide either mcp_server_id or mcp_url");
    throw new PayloadValidationError(issues);
  }

  if (hasServerId) {
    return {
      source: "server_id" as const,
      serverId: payload.mcp_server_id as string,
      mcpUrl: null as string | null,
    };
  }

  try {
    return {
      source: "mcp_url" as const,
      serverId: null as string | null,
      mcpUrl: canonicalizeMcpUrl(payload.mcp_url as string).canonicalUrl,
    };
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      throw error;
    }
    throw new PayloadValidationError(["mcp_url is invalid"]);
  }
}

function getServerMcpUrl(serverId: string) {
  const row = dbQueryFirst<{ mcp_url: string }>(
    "SELECT mcp_url FROM mcp_servers WHERE id = ? LIMIT 1",
    [serverId],
  );
  return row?.mcp_url ?? null;
}

export async function POST(request: Request) {
  bootstrapServerStore();

  let payload: DiscoverRequestPayload;
  try {
    payload = await readJsonObject(request);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  let resolvedInput: ReturnType<typeof resolveInputMcpUrl>;
  try {
    resolvedInput = resolveInputMcpUrl(payload);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  let mcpUrl: string | null = resolvedInput.mcpUrl;
  if (resolvedInput.source === "server_id") {
    mcpUrl = getServerMcpUrl(resolvedInput.serverId);
    if (!mcpUrl) {
      return errorResponse(404, "NOT_FOUND", "Server not found");
    }
  }

  if (!mcpUrl) {
    return errorResponse(400, "INVALID_REQUEST", "mcp_url could not be resolved");
  }

  try {
    const discovery = await discoverOAuthMetadata(mcpUrl);

    return NextResponse.json({
      discovery: {
        mcp_url: discovery.mcp_url,
        protected_resource_url: discovery.protected_resource_url,
        authorization_server_url: discovery.authorization_server_url,
        authorization_endpoint: discovery.authorization_server_metadata.authorization_endpoint,
        token_endpoint: discovery.authorization_server_metadata.token_endpoint,
        registration_endpoint: discovery.authorization_server_metadata.registration_endpoint,
        code_challenge_methods_supported:
          discovery.authorization_server_metadata.code_challenge_methods_supported,
        token_endpoint_auth_methods_supported:
          discovery.authorization_server_metadata.token_endpoint_auth_methods_supported,
        protected_resource_metadata: discovery.protected_resource_metadata,
        authorization_server_metadata: discovery.authorization_server_metadata,
      },
    });
  } catch (error) {
    if (isOAuthDiscoveryError(error)) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    return errorResponse(500, "INTERNAL_ERROR", "Unexpected discovery error");
  }
}
