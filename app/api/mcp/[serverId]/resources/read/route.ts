import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

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

  let validatedBody: ReadResourceRequestBody;
  try {
    const payload = await readJsonWithLimit(request);
    validatedBody = validateReadPayload(payload);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return errorResponse(422, "VALIDATION_ERROR", "Resource read payload exceeds allowed size", [
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
    const resource = await readResource({
      mcpServerId: serverId,
      uri: validatedBody.uri,
    });

    return NextResponse.json(resource);
  } catch (error) {
    if (isMcpResourceReadingError(error)) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to read MCP resource");
  }
}
