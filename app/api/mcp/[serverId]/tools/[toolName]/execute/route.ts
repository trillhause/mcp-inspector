import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import {
  recordExecutionHistory,
  summarizeToolArguments,
} from "@/lib/mcp/execution-history";
import {
  MCP_INTERACTION_ERROR_CATEGORY_BY_CODE,
  MCP_INTERACTION_MAX_BODY_BYTES,
  type ExecuteToolRequestBody,
  type McpInteractionErrorCode,
} from "@/lib/mcp/interaction-contract";
import { executeTool, isMcpToolExecutionError } from "@/lib/mcp/tool-execution";
import { bootstrapServerStore, PayloadValidationError } from "@/lib/servers";

export const runtime = "nodejs";

type ExecuteToolRequestPayload = {
  arguments?: unknown;
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

function normalizePathSegment(value: string, fieldName: "serverId" | "toolName") {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new PayloadValidationError([`${fieldName} route parameter is required`]);
  }

  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function persistToolHistory(input: {
  serverId: string;
  toolName: string;
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
  const requestArguments = isRecord(input.requestPayload)
    ? (input.requestPayload as Record<string, unknown>)
    : {};

  try {
    recordExecutionHistory({
      mcpServerId: input.serverId,
      actionType: "tool_execute",
      targetType: "tool",
      targetValue: input.toolName,
      status: input.status,
      latencyMs: input.latencyMs,
      requestSummary: summarizeToolArguments(requestArguments),
      requestPayload: requestArguments,
      responseContentType: input.responseContentType ?? null,
      responsePayload: input.responsePayload,
      error: input.error,
      createdAt: input.createdAt,
    });
  } catch (error) {
    console.warn("[mcp-tool-execution] failed to persist history", {
      server_id: input.serverId,
      tool_name: input.toolName,
      status: input.status,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

async function readJsonWithLimit(request: Request): Promise<ExecuteToolRequestPayload> {
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

  return payload as ExecuteToolRequestPayload;
}

function validateExecutePayload(payload: ExecuteToolRequestPayload): ExecuteToolRequestBody {
  if (payload.arguments === undefined) {
    return {};
  }

  if (!payload.arguments || typeof payload.arguments !== "object" || Array.isArray(payload.arguments)) {
    throw new PayloadValidationError(["arguments must be a JSON object when provided"]);
  }

  return {
    arguments: payload.arguments as Record<string, unknown>,
  };
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ serverId: string; toolName: string }>;
  },
) {
  bootstrapServerStore();
  const requestStartedAt = Date.now();

  let serverId: string;
  let toolName: string;
  try {
    const params = await context.params;
    serverId = normalizePathSegment(params.serverId, "serverId");
    toolName = normalizePathSegment(params.toolName, "toolName");
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  let requestPayloadForHistory: unknown = null;
  let validatedBody: ExecuteToolRequestBody;
  try {
    const payload = await readJsonWithLimit(request);
    requestPayloadForHistory = payload.arguments;
    validatedBody = validateExecutePayload(payload);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      persistToolHistory({
        serverId,
        toolName,
        status: "error",
        latencyMs: Date.now() - requestStartedAt,
        requestPayload: requestPayloadForHistory,
        error: {
          code: "VALIDATION_ERROR",
          message: "Tool arguments payload exceeds allowed size",
          details: [`max_bytes=${error.maxBytes}`, `actual_bytes=${error.actualBytes}`],
        },
      });
      return errorResponse(422, "VALIDATION_ERROR", "Tool arguments payload exceeds allowed size", [
        `max_bytes=${error.maxBytes}`,
        `actual_bytes=${error.actualBytes}`,
      ]);
    }

    if (error instanceof PayloadValidationError) {
      persistToolHistory({
        serverId,
        toolName,
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

    persistToolHistory({
      serverId,
      toolName,
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

  const argumentsPayload = validatedBody.arguments ?? {};

  try {
    const executed = await executeTool({
      mcpServerId: serverId,
      toolName,
      arguments: argumentsPayload,
    });

    persistToolHistory({
      serverId,
      toolName,
      status: "success",
      latencyMs: executed.latency_ms,
      requestPayload: argumentsPayload,
      responsePayload: executed.result,
      responseContentType: executed.content_type,
      createdAt: executed.executed_at,
    });

    return NextResponse.json(executed);
  } catch (error) {
    if (isMcpToolExecutionError(error)) {
      persistToolHistory({
        serverId,
        toolName,
        status: "error",
        latencyMs: Date.now() - requestStartedAt,
        requestPayload: argumentsPayload,
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      });
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    persistToolHistory({
      serverId,
      toolName,
      status: "error",
      latencyMs: Date.now() - requestStartedAt,
      requestPayload: argumentsPayload,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to execute MCP tool",
      },
    });
    return errorResponse(500, "INTERNAL_ERROR", "Failed to execute MCP tool");
  }
}
