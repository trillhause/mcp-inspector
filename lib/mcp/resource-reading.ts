import "server-only";

import { Buffer } from "node:buffer";

import type { Client } from "@modelcontextprotocol/sdk/client";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { readCachedCapabilities } from "@/lib/mcp/capabilities-store";
import { createMcpClientByServerId, isMcpClientError } from "@/lib/mcp/client";
import type {
  McpInteractionErrorCode,
  ReadResourceSuccessResponse,
} from "@/lib/mcp/interaction-contract";

const MAX_LIST_PAGES = 25;
const MAX_RESULT_CONTENT_ITEMS = 12;
const MAX_RESULT_TEXT_CHARS = 120_000;
const MAX_RESULT_BLOB_CHARS = 120_000;
const MAX_META_BYTES = 16 * 1024;
const MAX_PREVIEW_CHARS = 4_000;
const MAX_PREVIEW_DECODE_BYTES = 6_144;

type ResourceListItem = Awaited<ReturnType<Client["listResources"]>>["resources"][number];
type ReadResourceResult = Awaited<ReturnType<Client["readResource"]>>;
type ReadResourceContentItem = ReadResourceResult["contents"][number];

type ResourceListResult =
  | {
      supported: true;
      resources: ResourceListItem[];
    }
  | {
      supported: false;
      resources: [];
    };

type ResolvedResourceDefinition = {
  uri: string;
  mimeType: string | null;
};

type NormalizedResourceContent = {
  mimeType: string | null;
  contentType: string | null;
  preview: string | null;
  isTruncated: boolean;
};

export type ReadResourceInput = {
  mcpServerId: string;
  uri: string;
};

export class McpResourceReadingError extends Error {
  readonly code: McpInteractionErrorCode;
  readonly httpStatus: number;
  readonly details?: string[];

  constructor(
    code: McpResourceReadingError["code"],
    message: string,
    options?: {
      httpStatus?: number;
      details?: string[];
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "McpResourceReadingError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 500;
    this.details = options?.details;
  }
}

export function isMcpResourceReadingError(error: unknown): error is McpResourceReadingError {
  return error instanceof McpResourceReadingError;
}

function logResourceReadEvent(
  level: "info" | "warn" | "error",
  event: string,
  context: Record<string, unknown>,
) {
  const message = `[mcp-resource-read] ${event}`;
  if (level === "warn") {
    console.warn(message, context);
    return;
  }
  if (level === "error") {
    console.error(message, context);
    return;
  }
  console.info(message, context);
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasReconnectRequiredDetail(details: string[] | undefined) {
  if (!details || details.length === 0) {
    return false;
  }

  return details.some((detail) => detail.toLowerCase().includes("reconnect_required=true"));
}

function mapMcpClientError(error: unknown): McpResourceReadingError {
  if (!isMcpClientError(error)) {
    return new McpResourceReadingError("INTERNAL_ERROR", "Unexpected MCP session error", {
      httpStatus: 500,
      cause: error,
    });
  }

  if (error.code === "AUTH_REQUIRED" && hasReconnectRequiredDetail(error.details)) {
    return new McpResourceReadingError("RECONNECT_REQUIRED", "Reconnect is required before reading resources", {
      httpStatus: 401,
      details: error.details,
      cause: error,
    });
  }

  if (error.code === "NOT_CONNECTED") {
    return new McpResourceReadingError("NOT_CONNECTED", error.message, {
      httpStatus: error.httpStatus,
      details: error.details,
      cause: error,
    });
  }

  if (error.code === "AUTH_REQUIRED") {
    return new McpResourceReadingError("AUTH_REQUIRED", error.message, {
      httpStatus: error.httpStatus,
      details: error.details,
      cause: error,
    });
  }

  return new McpResourceReadingError("MCP_CONNECT_FAILED", error.message, {
    httpStatus: error.httpStatus,
    details: error.details,
    cause: error,
  });
}

function normalizeCursor(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUnsupportedResourcesListError(error: unknown) {
  if (error instanceof McpError) {
    if (error.code === ErrorCode.MethodNotFound) {
      return true;
    }

    if (error.code === ErrorCode.InvalidRequest) {
      const message = error.message.toLowerCase();
      return (
        message.includes("method not found") ||
        message.includes("unknown method") ||
        message.includes("not supported")
      );
    }

    return false;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("method not found") ||
      message.includes("unknown method") ||
      message.includes("not supported")
    );
  }

  return false;
}

function getCachedResourceDefinition(
  mcpServerId: string,
  resourceUri: string,
): ResolvedResourceDefinition | null {
  const cached = readCachedCapabilities(mcpServerId);
  if (!cached || cached.resources.length === 0) {
    return null;
  }

  const resource = cached.resources.find((candidate) => candidate.uri === resourceUri);
  if (!resource) {
    return null;
  }

  return {
    uri: resource.uri,
    mimeType: normalizeOptionalString(resource.mimeType),
  };
}

async function listResourcesForValidation(
  mcpServerId: string,
  client: Client,
): Promise<ResourceListResult> {
  const resources: ResourceListItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined = undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    let response: Awaited<ReturnType<Client["listResources"]>>;
    try {
      response = await client.listResources(cursor ? { cursor } : undefined);
    } catch (error) {
      if (isUnsupportedResourcesListError(error)) {
        return {
          supported: false,
          resources: [],
        };
      }

      throw new McpResourceReadingError(
        "READ_FAILED",
        "Failed to load resources for URI validation",
        {
          httpStatus: 502,
          details: [`mcp_server_id=${mcpServerId}`],
          cause: error,
        },
      );
    }

    resources.push(...response.resources);
    const nextCursor = normalizeCursor(response.nextCursor);

    if (!nextCursor) {
      return {
        supported: true,
        resources,
      };
    }

    if (seenCursors.has(nextCursor)) {
      throw new McpResourceReadingError("READ_FAILED", "Resource discovery cursor loop detected", {
        httpStatus: 502,
        details: [`mcp_server_id=${mcpServerId}`],
      });
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new McpResourceReadingError("READ_FAILED", "Resource discovery exceeded pagination limit", {
    httpStatus: 502,
    details: [`mcp_server_id=${mcpServerId}`, `max_pages=${MAX_LIST_PAGES}`],
  });
}

async function resolveResourceDefinition(
  mcpServerId: string,
  resourceUri: string,
  client: Client,
): Promise<ResolvedResourceDefinition | null> {
  const cached = getCachedResourceDefinition(mcpServerId, resourceUri);
  if (cached) {
    return cached;
  }

  const liveResources = await listResourcesForValidation(mcpServerId, client);
  if (!liveResources.supported) {
    return null;
  }

  const resource = liveResources.resources.find((candidate) => candidate.uri === resourceUri);
  if (!resource) {
    throw new McpResourceReadingError("RESOURCE_NOT_FOUND", "Requested resource URI was not found on this server", {
      httpStatus: 404,
      details: [`uri=${resourceUri}`],
    });
  }

  return {
    uri: resource.uri,
    mimeType: normalizeOptionalString(resource.mimeType),
  };
}

function sanitizeErrorDetail(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function isUnknownResourceMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unknown resource") ||
    normalized.includes("resource not found") ||
    normalized.includes("no such resource") ||
    normalized.includes("unrecognized resource")
  );
}

function isUnsupportedResourcesReadError(error: unknown) {
  if (error instanceof McpError) {
    if (error.code === ErrorCode.MethodNotFound) {
      return true;
    }

    if (error.code === ErrorCode.InvalidRequest) {
      const message = error.message.toLowerCase();
      return (
        message.includes("method not found") ||
        message.includes("unknown method") ||
        message.includes("not supported")
      );
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("method not found") ||
      message.includes("unknown method") ||
      message.includes("not supported")
    );
  }

  return false;
}

function mapReadResourceFailure(error: unknown, uri: string): McpResourceReadingError {
  if (isUnknownResourceMessage(error instanceof Error ? error.message : String(error))) {
    return new McpResourceReadingError(
      "RESOURCE_NOT_FOUND",
      "Requested resource URI was not found on this server",
      {
        httpStatus: 404,
        details: [`uri=${uri}`],
        cause: error,
      },
    );
  }

  if (isUnsupportedResourcesReadError(error)) {
    return new McpResourceReadingError("READ_FAILED", "MCP server does not support resources/read", {
      httpStatus: 502,
      details: [`uri=${uri}`],
      cause: error,
    });
  }

  if (error instanceof McpError && error.code === ErrorCode.InvalidParams) {
    return new McpResourceReadingError(
      "READ_FAILED",
      "MCP server rejected the resource URI",
      {
        httpStatus: 502,
        details: [sanitizeErrorDetail(error.message)],
        cause: error,
      },
    );
  }

  return new McpResourceReadingError("READ_FAILED", "MCP resource read failed", {
    httpStatus: 502,
    details: [`uri=${uri}`],
    cause: error,
  });
}

function isJsonMimeType(mimeType: string | null) {
  if (!mimeType) {
    return false;
  }

  const normalized = mimeType.toLowerCase();
  return normalized === "application/json" || normalized.endsWith("+json");
}

function isTextLikeMimeType(mimeType: string | null) {
  if (!mimeType) {
    return false;
  }

  const normalized = mimeType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml") ||
    normalized.includes("javascript")
  );
}

function shouldAttemptJsonFormatting(text: string, mimeType: string | null) {
  if (isJsonMimeType(mimeType)) {
    return true;
  }

  if (mimeType) {
    return false;
  }

  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function truncateString(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return {
      value,
      truncated: false,
    };
  }

  return {
    value: `${value.slice(0, maxChars)}\n…[truncated]`,
    truncated: true,
  };
}

function normalizeTextContent(text: string, mimeType: string | null) {
  let normalizedText = text;
  let inferredMimeType = mimeType;

  if (shouldAttemptJsonFormatting(text, mimeType)) {
    try {
      normalizedText = JSON.stringify(JSON.parse(text), null, 2);
      inferredMimeType = "application/json";
    } catch {
      // Keep original text if it's not valid JSON.
    }
  }

  const preview = truncateString(normalizedText, MAX_PREVIEW_CHARS);
  return {
    mimeType: inferredMimeType,
    preview: preview.value,
    previewTruncated: preview.truncated,
  };
}

function estimateBase64ByteLength(base64: string) {
  const normalized = base64.trim();
  if (!normalized) {
    return 0;
  }

  const paddingChars = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - paddingChars);
}

function decodeBase64Preview(blobBase64: string, maxBytes: number) {
  const maxChars = Math.ceil(maxBytes / 3) * 4;
  const slicedBase64 = blobBase64.slice(0, maxChars);

  try {
    return Buffer.from(slicedBase64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function normalizeBlobPreview(blobBase64: string, mimeType: string | null) {
  if (!isTextLikeMimeType(mimeType)) {
    return {
      preview: null,
      previewTruncated: estimateBase64ByteLength(blobBase64) > 0,
    };
  }

  const estimatedBytes = estimateBase64ByteLength(blobBase64);
  const decoded = decodeBase64Preview(blobBase64, MAX_PREVIEW_DECODE_BYTES);
  if (decoded === null) {
    return {
      preview: null,
      previewTruncated: estimatedBytes > 0,
    };
  }

  const preview = truncateString(decoded, MAX_PREVIEW_CHARS);
  return {
    preview: preview.value,
    previewTruncated: preview.truncated || estimatedBytes > MAX_PREVIEW_DECODE_BYTES,
  };
}

function toJsonSafeValueWithLimit(value: unknown, maxBytes: number) {
  try {
    const serialized = JSON.stringify(value, (_key, candidate) =>
      typeof candidate === "bigint" ? candidate.toString() : candidate,
    );

    if (!serialized) {
      return null;
    }

    if (Buffer.byteLength(serialized, "utf8") <= maxBytes) {
      return JSON.parse(serialized) as unknown;
    }

    return {
      serialization_warning: `value exceeded ${maxBytes} bytes and was omitted`,
    };
  } catch {
    return {
      serialization_warning: "value could not be serialized",
    };
  }
}

function sanitizeReadContentItem(
  content: ReadResourceContentItem,
  truncation: { value: boolean },
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    uri: content.uri,
    ...(content.mimeType ? { mimeType: content.mimeType } : {}),
  };

  if ("text" in content && typeof content.text === "string") {
    const truncated = truncateString(content.text, MAX_RESULT_TEXT_CHARS);
    sanitized.text = truncated.value;
    if (truncated.truncated) {
      truncation.value = true;
    }
  } else if ("blob" in content && typeof content.blob === "string") {
    const truncated = truncateString(content.blob, MAX_RESULT_BLOB_CHARS);
    sanitized.blob = truncated.value;
    if (truncated.truncated) {
      truncation.value = true;
    }
  }

  if (content._meta !== undefined) {
    sanitized._meta = toJsonSafeValueWithLimit(content._meta, MAX_META_BYTES);
  }

  return sanitized;
}

function sanitizeReadResourceResult(
  result: ReadResourceResult,
): { result: Record<string, unknown>; truncated: boolean } {
  const truncation = { value: false };
  const sanitizedContents: Record<string, unknown>[] = [];

  const maxItems = Math.min(result.contents.length, MAX_RESULT_CONTENT_ITEMS);
  for (let index = 0; index < maxItems; index += 1) {
    sanitizedContents.push(sanitizeReadContentItem(result.contents[index], truncation));
  }

  if (result.contents.length > MAX_RESULT_CONTENT_ITEMS) {
    truncation.value = true;
  }

  const sanitized: Record<string, unknown> = {
    contents: sanitizedContents,
  };

  if (result.contents.length > MAX_RESULT_CONTENT_ITEMS) {
    sanitized.omitted_content_items = result.contents.length - MAX_RESULT_CONTENT_ITEMS;
  }

  if ("_meta" in result) {
    sanitized._meta = toJsonSafeValueWithLimit(result._meta, MAX_META_BYTES);
  }

  return {
    result: sanitized,
    truncated: truncation.value,
  };
}

function normalizeContentMetadata(
  result: ReadResourceResult,
  fallbackMimeType: string | null,
): NormalizedResourceContent {
  if (!Array.isArray(result.contents) || result.contents.length === 0) {
    return {
      mimeType: fallbackMimeType,
      contentType: fallbackMimeType,
      preview: null,
      isTruncated: false,
    };
  }

  const first = result.contents[0];
  const mimeType = normalizeOptionalString(first.mimeType) ?? fallbackMimeType;
  const hasAdditionalContents = result.contents.length > 1;

  if ("text" in first && typeof first.text === "string") {
    const normalizedText = normalizeTextContent(first.text, mimeType);
    return {
      mimeType: normalizedText.mimeType,
      contentType: normalizedText.mimeType,
      preview: normalizedText.preview,
      isTruncated: normalizedText.previewTruncated || hasAdditionalContents,
    };
  }

  if ("blob" in first && typeof first.blob === "string") {
    const normalizedBlob = normalizeBlobPreview(first.blob, mimeType);
    return {
      mimeType,
      contentType: mimeType,
      preview: normalizedBlob.preview,
      isTruncated: normalizedBlob.previewTruncated || hasAdditionalContents,
    };
  }

  return {
    mimeType,
    contentType: mimeType,
    preview: null,
    isTruncated: hasAdditionalContents,
  };
}

export async function readResource(input: ReadResourceInput): Promise<ReadResourceSuccessResponse> {
  const startedAt = Date.now();
  let session: Awaited<ReturnType<typeof createMcpClientByServerId>> | null = null;

  try {
    session = await createMcpClientByServerId(input.mcpServerId);
  } catch (error) {
    const mapped = mapMcpClientError(error);
    logResourceReadEvent("warn", "session_open_failed", {
      mcp_server_id: input.mcpServerId,
      uri: input.uri,
      code: mapped.code,
    });
    throw mapped;
  }

  try {
    const resource = await resolveResourceDefinition(input.mcpServerId, input.uri, session.client);

    let rawResult: ReadResourceResult;
    try {
      rawResult = await session.client.readResource({
        uri: input.uri,
      });
    } catch (error) {
      throw mapReadResourceFailure(error, input.uri);
    }

    const normalized = normalizeContentMetadata(rawResult, resource?.mimeType ?? null);
    const sanitizedResult = sanitizeReadResourceResult(rawResult);

    const response: ReadResourceSuccessResponse = {
      mcp_server_id: input.mcpServerId,
      target: {
        type: "resource",
        uri: input.uri,
      },
      status: "success",
      latency_ms: Date.now() - startedAt,
      content_type: normalized.contentType,
      executed_at: new Date().toISOString(),
      mimeType: normalized.mimeType,
      preview: normalized.preview,
      is_truncated: normalized.isTruncated || sanitizedResult.truncated,
      result: sanitizedResult.result,
    };

    logResourceReadEvent("info", "resource_read", {
      mcp_server_id: input.mcpServerId,
      uri: input.uri,
      latency_ms: response.latency_ms,
      selected_transport: session.connection.selected_transport,
      refreshed_before_connect: session.connection.refreshed_before_connect,
      is_truncated: response.is_truncated,
    });

    return response;
  } catch (error) {
    if (isMcpResourceReadingError(error)) {
      logResourceReadEvent("warn", "resource_read_failed", {
        mcp_server_id: input.mcpServerId,
        uri: input.uri,
        code: error.code,
      });
      throw error;
    }

    logResourceReadEvent("error", "resource_read_unexpected_failure", {
      mcp_server_id: input.mcpServerId,
      uri: input.uri,
    });

    throw new McpResourceReadingError("INTERNAL_ERROR", "Unexpected resource reading failure", {
      httpStatus: 500,
      cause: error,
    });
  } finally {
    if (session) {
      await session.close().catch(() => undefined);
    }
  }
}
