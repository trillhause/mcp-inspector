export const MCP_TOOL_EXECUTE_ROUTE = "/api/mcp/[serverId]/tools/[toolName]/execute" as const;
export const MCP_RESOURCE_READ_ROUTE = "/api/mcp/[serverId]/resources/read" as const;
export const MCP_EXECUTION_HISTORY_ROUTE = "/api/mcp/[serverId]/history" as const;

export const MCP_INTERACTION_MAX_BODY_BYTES = 128 * 1024;

export type InteractionRunState = "idle" | "validating" | "executing" | "success" | "error";
export type McpInteractionStatus = "success" | "error";

export type McpInteractionTarget =
  | { type: "tool"; tool_name: string }
  | { type: "resource"; uri: string };

export type McpInteractionErrorCategory =
  | "validation"
  | "auth"
  | "connection"
  | "not_found"
  | "execution"
  | "internal";

export type McpInteractionErrorCode =
  | "INVALID_REQUEST"
  | "VALIDATION_ERROR"
  | "NOT_CONNECTED"
  | "AUTH_REQUIRED"
  | "RECONNECT_REQUIRED"
  | "TOOL_NOT_FOUND"
  | "RESOURCE_NOT_FOUND"
  | "MCP_CONNECT_FAILED"
  | "EXECUTION_FAILED"
  | "READ_FAILED"
  | "INTERNAL_ERROR";

export const MCP_INTERACTION_ERROR_CATEGORY_BY_CODE: Record<
  McpInteractionErrorCode,
  McpInteractionErrorCategory
> = {
  INVALID_REQUEST: "validation",
  VALIDATION_ERROR: "validation",
  NOT_CONNECTED: "connection",
  AUTH_REQUIRED: "auth",
  RECONNECT_REQUIRED: "auth",
  TOOL_NOT_FOUND: "not_found",
  RESOURCE_NOT_FOUND: "not_found",
  MCP_CONNECT_FAILED: "connection",
  EXECUTION_FAILED: "execution",
  READ_FAILED: "execution",
  INTERNAL_ERROR: "internal",
};

export type McpInteractionEnvelopeBase = {
  mcp_server_id: string;
  target: McpInteractionTarget;
  status: McpInteractionStatus;
  latency_ms: number;
  content_type: string | null;
  executed_at: string;
};

export type McpInteractionErrorPayload = {
  error: {
    code: McpInteractionErrorCode;
    category: McpInteractionErrorCategory;
    message: string;
    details?: string[];
  };
};

export type ExecuteToolRequestBody = {
  arguments?: Record<string, unknown>;
};

export type ExecuteToolSuccessResponse = McpInteractionEnvelopeBase & {
  target: { type: "tool"; tool_name: string };
  status: "success";
  content_type: "application/json";
  result: unknown;
};

export type ExecuteToolErrorResponse = McpInteractionErrorPayload;

export type ReadResourceRequestBody = {
  uri: string;
};

export type ReadResourceSuccessResponse = McpInteractionEnvelopeBase & {
  target: { type: "resource"; uri: string };
  status: "success";
  mimeType: string | null;
  preview: string | null;
  is_truncated: boolean;
  result: unknown;
};

export type ReadResourceErrorResponse = McpInteractionErrorPayload;

export type McpExecutionHistoryActionType = "tool_execute" | "resource_read";
export type McpExecutionHistoryTargetType = "tool" | "resource";

export type McpExecutionHistoryItem = {
  id: string;
  mcp_server_id: string;
  action_type: McpExecutionHistoryActionType;
  target: {
    type: McpExecutionHistoryTargetType;
    value: string;
  };
  status: McpInteractionStatus;
  latency_ms: number;
  request_summary: string | null;
  request_payload: unknown;
  response_content_type: string | null;
  response_payload: unknown;
  error: {
    code: string;
    category: McpInteractionErrorCategory | null;
    message: string;
    details: string[];
  } | null;
  created_at: string;
};

export type ListExecutionHistoryResponse = {
  mcp_server_id: string;
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
  items: McpExecutionHistoryItem[];
};
