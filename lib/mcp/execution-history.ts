import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { dbExecute, dbQueryAll } from "@/lib/db";
import {
  MCP_INTERACTION_ERROR_CATEGORY_BY_CODE,
  type McpExecutionHistoryActionType,
  type McpExecutionHistoryItem,
  type McpExecutionHistoryTargetType,
  type McpInteractionErrorCategory,
  type McpInteractionErrorCode,
  type McpInteractionStatus,
} from "@/lib/mcp/interaction-contract";

const MAX_STORED_PAYLOAD_BYTES = 40 * 1024;
const MAX_TRUNCATED_PREVIEW_CHARS = 2_000;
const MAX_SUMMARY_CHARS = 280;
const MAX_SUMMARY_ITEMS = 8;

type HistoryRow = {
  id: string;
  mcp_server_id: string;
  action_type: string;
  target_type: string;
  target_value: string;
  status: string;
  latency_ms: number;
  request_summary: string | null;
  request_payload: string | null;
  response_content_type: string | null;
  response_payload: string | null;
  error_code: string | null;
  error_category: string | null;
  error_message: string | null;
  error_details: string | null;
  created_at: string;
};

type CursorState = {
  created_at: string;
  id: string;
};

export type RecordExecutionHistoryInput = {
  mcpServerId: string;
  actionType: McpExecutionHistoryActionType;
  targetType: McpExecutionHistoryTargetType;
  targetValue: string;
  status: McpInteractionStatus;
  latencyMs: number;
  requestSummary?: string | null;
  requestPayload?: unknown;
  responseContentType?: string | null;
  responsePayload?: unknown;
  error?: {
    code?: string | null;
    message?: string | null;
    details?: string[] | null;
  } | null;
  createdAt?: string;
};

export type ListExecutionHistoryInput = {
  mcpServerId: string;
  limit: number;
  cursor?: string | null;
  actionType?: McpExecutionHistoryActionType;
  status?: McpInteractionStatus;
};

export class ExecutionHistoryCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionHistoryCursorError";
  }
}

export type ListExecutionHistoryResult = {
  items: McpExecutionHistoryItem[];
  nextCursor: string | null;
};

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3)}...`;
}

function normalizeLatency(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function safeJsonStringify(value: unknown) {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === "bigint") {
        return nestedValue.toString();
      }

      if (typeof nestedValue === "function") {
        return "[Function]";
      }

      if (nestedValue === undefined) {
        return "[undefined]";
      }

      if (nestedValue && typeof nestedValue === "object") {
        if (seen.has(nestedValue)) {
          return "[Circular]";
        }
        seen.add(nestedValue);
      }

      return nestedValue;
    });
  } catch {
    return null;
  }
}

function serializePayloadForStorage(payload: unknown) {
  if (payload === undefined || payload === null) {
    return null;
  }

  const serialized = safeJsonStringify(payload);
  if (!serialized) {
    return safeJsonStringify({
      serialization_warning: "payload could not be serialized",
    });
  }

  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength <= MAX_STORED_PAYLOAD_BYTES) {
    return serialized;
  }

  return safeJsonStringify({
    truncated: true,
    max_bytes: MAX_STORED_PAYLOAD_BYTES,
    original_bytes: byteLength,
    preview: truncateText(serialized, MAX_TRUNCATED_PREVIEW_CHARS),
  });
}

function parseJsonValue(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function parseErrorDetails(value: string | null) {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => Boolean(item));
}

function resolveErrorCategory(code: string | null) {
  if (!code) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(MCP_INTERACTION_ERROR_CATEGORY_BY_CODE, code)) {
    return MCP_INTERACTION_ERROR_CATEGORY_BY_CODE[code as McpInteractionErrorCode];
  }

  return null;
}

function normalizeActionType(value: string): McpExecutionHistoryActionType {
  return value === "resource_read" ? "resource_read" : "tool_execute";
}

function normalizeTargetType(value: string): McpExecutionHistoryTargetType {
  return value === "resource" ? "resource" : "tool";
}

function normalizeStatus(value: string): McpInteractionStatus {
  return value === "success" ? "success" : "error";
}

function normalizeCreatedAt(value: string | undefined) {
  const parsed = value ? new Date(value) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return new Date().toISOString();
}

function normalizeSummary(value: string | null | undefined) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  return truncateText(normalized, MAX_SUMMARY_CHARS);
}

function describeValueKind(value: unknown) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }

  if (typeof value === "string") {
    return `string(${value.length})`;
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (value && typeof value === "object") {
    return `object(${Object.keys(value).length})`;
  }

  return typeof value;
}

function mapHistoryRow(row: HistoryRow): McpExecutionHistoryItem {
  const errorCode = normalizeOptionalString(row.error_code);
  const errorMessage = normalizeOptionalString(row.error_message);
  const errorDetails = parseErrorDetails(row.error_details);
  const resolvedErrorCategory =
    normalizeOptionalString(row.error_category) ?? resolveErrorCategory(errorCode);

  return {
    id: row.id,
    mcp_server_id: row.mcp_server_id,
    action_type: normalizeActionType(row.action_type),
    target: {
      type: normalizeTargetType(row.target_type),
      value: row.target_value,
    },
    status: normalizeStatus(row.status),
    latency_ms: normalizeLatency(row.latency_ms),
    request_summary: normalizeOptionalString(row.request_summary),
    request_payload: parseJsonValue(row.request_payload),
    response_content_type: normalizeOptionalString(row.response_content_type),
    response_payload: parseJsonValue(row.response_payload),
    error:
      errorCode || errorMessage || errorDetails.length > 0
        ? {
            code: errorCode ?? "UNKNOWN_ERROR",
            category: resolvedErrorCategory as McpInteractionErrorCategory | null,
            message: errorMessage ?? "Unknown history error",
            details: errorDetails,
          }
        : null,
    created_at: row.created_at,
  };
}

function encodeCursor(state: CursorState) {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorState {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ExecutionHistoryCursorError("Invalid history cursor format");
    }

    const createdAt = normalizeOptionalString((parsed as Record<string, unknown>).created_at);
    const id = normalizeOptionalString((parsed as Record<string, unknown>).id);
    if (!createdAt || !id) {
      throw new ExecutionHistoryCursorError("Invalid history cursor payload");
    }

    return {
      created_at: createdAt,
      id,
    };
  } catch (error) {
    if (error instanceof ExecutionHistoryCursorError) {
      throw error;
    }

    throw new ExecutionHistoryCursorError("Failed to decode history cursor");
  }
}

export function summarizeToolArguments(argumentsPayload: Record<string, unknown>) {
  const entries = Object.entries(argumentsPayload);
  if (entries.length === 0) {
    return "No arguments";
  }

  const summaryValues = entries
    .slice(0, MAX_SUMMARY_ITEMS)
    .map(([key, value]) => `${key}:${describeValueKind(value)}`);
  const omitted = entries.length - summaryValues.length;
  const suffix = omitted > 0 ? ` +${omitted} more` : "";

  return truncateText(
    `${entries.length} arg${entries.length === 1 ? "" : "s"} - ${summaryValues.join(", ")}${suffix}`,
    MAX_SUMMARY_CHARS,
  );
}

export function summarizeResourceRead(uri: string) {
  return truncateText(`uri=${uri}`, MAX_SUMMARY_CHARS);
}

export function recordExecutionHistory(input: RecordExecutionHistoryInput) {
  const errorCode = normalizeOptionalString(input.error?.code);
  const errorMessage = normalizeOptionalString(input.error?.message);
  const errorDetails =
    input.error?.details
      ?.map((detail) => normalizeOptionalString(detail))
      .filter((detail): detail is string => Boolean(detail)) ?? [];

  dbExecute(
    `INSERT INTO mcp_execution_history (
      id,
      mcp_server_id,
      action_type,
      target_type,
      target_value,
      status,
      latency_ms,
      request_summary,
      request_payload,
      response_content_type,
      response_payload,
      error_code,
      error_category,
      error_message,
      error_details,
      created_at
    ) VALUES (
      @id,
      @mcp_server_id,
      @action_type,
      @target_type,
      @target_value,
      @status,
      @latency_ms,
      @request_summary,
      @request_payload,
      @response_content_type,
      @response_payload,
      @error_code,
      @error_category,
      @error_message,
      @error_details,
      @created_at
    )`,
    {
      id: randomUUID(),
      mcp_server_id: input.mcpServerId,
      action_type: input.actionType,
      target_type: input.targetType,
      target_value: input.targetValue,
      status: input.status,
      latency_ms: normalizeLatency(input.latencyMs),
      request_summary: normalizeSummary(input.requestSummary),
      request_payload: serializePayloadForStorage(input.requestPayload),
      response_content_type: normalizeOptionalString(input.responseContentType),
      response_payload: serializePayloadForStorage(input.responsePayload),
      error_code: errorCode,
      error_category: resolveErrorCategory(errorCode),
      error_message: errorMessage,
      error_details: errorDetails.length > 0 ? safeJsonStringify(errorDetails) : null,
      created_at: normalizeCreatedAt(input.createdAt),
    },
  );
}

export function listExecutionHistoryForServer(
  input: ListExecutionHistoryInput,
): ListExecutionHistoryResult {
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const queryLimit = input.limit + 1;
  const params: Record<string, string | number> = {
    mcp_server_id: input.mcpServerId,
    query_limit: queryLimit,
  };

  const cursorClause = cursor
    ? `AND (
        created_at < @cursor_created_at
        OR (created_at = @cursor_created_at AND id < @cursor_id)
      )`
    : "";

  if (cursor) {
    params.cursor_created_at = cursor.created_at;
    params.cursor_id = cursor.id;
  }
  const actionTypeClause = input.actionType ? "AND action_type = @action_type" : "";
  if (input.actionType) {
    params.action_type = input.actionType;
  }
  const statusClause = input.status ? "AND status = @status" : "";
  if (input.status) {
    params.status = input.status;
  }

  const rows = dbQueryAll<HistoryRow>(
    `SELECT
      id,
      mcp_server_id,
      action_type,
      target_type,
      target_value,
      status,
      latency_ms,
      request_summary,
      request_payload,
      response_content_type,
      response_payload,
      error_code,
      error_category,
      error_message,
      error_details,
      created_at
    FROM mcp_execution_history
    WHERE mcp_server_id = @mcp_server_id
      ${actionTypeClause}
      ${statusClause}
      ${cursorClause}
    ORDER BY created_at DESC, id DESC
    LIMIT @query_limit`,
    params,
  );

  const hasMore = rows.length > input.limit;
  const visibleRows = hasMore ? rows.slice(0, input.limit) : rows;
  const items = visibleRows.map((row) => mapHistoryRow(row));
  const lastItem = items[items.length - 1];

  return {
    items,
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({
            created_at: lastItem.created_at,
            id: lastItem.id,
          })
        : null,
  };
}
