import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

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

  let validatedBody: ExecuteToolRequestBody;
  try {
    const payload = await readJsonWithLimit(request);
    validatedBody = validateExecutePayload(payload);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return errorResponse(422, "VALIDATION_ERROR", "Tool arguments payload exceeds allowed size", [
        `max_bytes=${error.maxBytes}`,
        `actual_bytes=${error.actualBytes}`,
      ]);
    }

    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  try {
    const executed = await executeTool({
      mcpServerId: serverId,
      toolName,
      arguments: validatedBody.arguments ?? {},
    });

    return NextResponse.json(executed);
  } catch (error) {
    if (isMcpToolExecutionError(error)) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to execute MCP tool");
  }
}
