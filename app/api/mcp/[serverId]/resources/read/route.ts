import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import {
  recordExecutionHistory,
  summarizeResourceRead,
} from "@/lib/mcp/execution-history";
import {
  MCP_INTERACTION_ERROR_CATEGORY_BY_CODE,
  MCP_INTERACTION_MAX_BODY_BYTES,
  type McpInteractionErrorCode,
  type ReadResourceRequestBody,
} from "@/lib/mcp/interaction-contract";
import {
  isMcpResourceReadingError,
  readResource,
} from "@/lib/mcp/resource-reading";
import { bootstrapServerStore, PayloadValidationError } from "@/lib/servers";

export const runtime = "nodejs";

type ReadResourceRequestPayload = {
  uri?: unknown;
};

class PayloadTooLargeError extends Error {
  readonly actualBytes: number;
  readonly maxBytes: number;

  constructor(actualBytes: number, maxBytes: number) {
    super(`Request body exceeds ${maxBytes} byte limit`);
    this.name = "PayloadTooLargeError";
    this.actualBytes = actualBytes;
    this.maxBytes = maxBytes;
  }
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveTargetUri(payload: unknown) {
  if (!isRecord(payload) || typeof payload.uri !== "string") {
    return "unknown-resource-uri";
  }

  const trimmed = payload.uri.trim();
  return trimmed.length > 0 ? trimmed : "unknown-resource-uri";
}

function persistResourceHistory(input: {
  serverId: string;
  uri: string;
  status: "success" | "error";
  latencyMs: number;
  requestPayload?: unknown;
  responsePayload?: unknown;
  responseContentType?: string | null;
  error?: {
    code?: string | null;
    message?: string | null;
    details?: string[] | null;
  } | null;
  createdAt?: string;
}) {
  try {
    recordExecutionHistory({
      mcpServerId: input.serverId,
      actionType: "resource_read",
      targetType: "resource",
      targetValue: input.uri,
      status: input.status,
      latencyMs: input.latencyMs,
      requestSummary: summarizeResourceRead(input.uri),
      requestPayload: input.requestPayload,
      responseContentType: input.responseContentType ?? null,
      responsePayload: input.responsePayload,
      error: input.error,
      createdAt: input.createdAt,
    });
  } catch (error) {
    console.warn("[mcp-resource-read] failed to persist history", {
      server_id: input.serverId,
      uri: input.uri,
      status: input.status,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

async function readJsonWithLimit(request: Request): Promise<ReadResourceRequestPayload> {
  const bodyBuffer = Buffer.from(await request.arrayBuffer());
  if (bodyBuffer.byteLength > MCP_INTERACTION_MAX_BODY_BYTES) {
    throw new PayloadTooLargeError(bodyBuffer.byteLength, MCP_INTERACTION_MAX_BODY_BYTES);
  }

  const rawBody = bodyBuffer.toString("utf8").trim();
  if (!rawBody) {
    return {};
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new PayloadValidationError(["Request body must be valid JSON"]);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PayloadValidationError(["Request body must be a JSON object"]);
  }

  return payload as ReadResourceRequestPayload;
}

function validateReadPayload(payload: ReadResourceRequestPayload): ReadResourceRequestBody {
  if (typeof payload.uri !== "string") {
    throw new PayloadValidationError(["uri is required and must be a string"]);
  }

  const uri = payload.uri.trim();
  if (!uri) {
    throw new PayloadValidationError(["uri is required and must be a non-empty string"]);
  }

  return {
    uri,
  };
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ serverId: string }>;
  },
) {
  bootstrapServerStore();
  const requestStartedAt = Date.now();

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

  let requestPayloadForHistory: unknown = null;
  let historyTargetUri = "unknown-resource-uri";
  let validatedBody: ReadResourceRequestBody;
  try {
    const payload = await readJsonWithLimit(request);
    requestPayloadForHistory = payload;
    historyTargetUri = resolveTargetUri(payload);
    validatedBody = validateReadPayload(payload);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      persistResourceHistory({
        serverId,
        uri: historyTargetUri,
        status: "error",
        latencyMs: Date.now() - requestStartedAt,
        requestPayload: requestPayloadForHistory,
        error: {
          code: "VALIDATION_ERROR",
          message: "Resource read payload exceeds allowed size",
          details: [`max_bytes=${error.maxBytes}`, `actual_bytes=${error.actualBytes}`],
        },
      });
      return errorResponse(422, "VALIDATION_ERROR", "Resource read payload exceeds allowed size", [
        `max_bytes=${error.maxBytes}`,
        `actual_bytes=${error.actualBytes}`,
      ]);
    }

    if (error instanceof PayloadValidationError) {
      persistResourceHistory({
        serverId,
        uri: historyTargetUri,
        status: "error",
        latencyMs: Date.now() - requestStartedAt,
        requestPayload: requestPayloadForHistory,
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed",
          details: error.issues,
        },
      });
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    persistResourceHistory({
      serverId,
      uri: historyTargetUri,
      status: "error",
      latencyMs: Date.now() - requestStartedAt,
      requestPayload: requestPayloadForHistory,
      error: {
        code: "INVALID_REQUEST",
        message: "Request validation failed",
      },
    });
    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  historyTargetUri = validatedBody.uri;

  try {
    const resource = await readResource({
      mcpServerId: serverId,
      uri: validatedBody.uri,
    });

    persistResourceHistory({
      serverId,
      uri: validatedBody.uri,
      status: "success",
      latencyMs: resource.latency_ms,
      requestPayload: { uri: validatedBody.uri },
      responsePayload: resource.result,
      responseContentType: resource.content_type,
      createdAt: resource.executed_at,
    });

    return NextResponse.json(resource);
  } catch (error) {
    if (isMcpResourceReadingError(error)) {
      persistResourceHistory({
        serverId,
        uri: validatedBody.uri,
        status: "error",
        latencyMs: Date.now() - requestStartedAt,
        requestPayload: { uri: validatedBody.uri },
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      });
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    persistResourceHistory({
      serverId,
      uri: validatedBody.uri,
      status: "error",
      latencyMs: Date.now() - requestStartedAt,
      requestPayload: { uri: validatedBody.uri },
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to read MCP resource",
      },
    });
    return errorResponse(500, "INTERNAL_ERROR", "Failed to read MCP resource");
  }
}
