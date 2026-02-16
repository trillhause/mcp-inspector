export const MCP_TOOL_EXECUTE_ROUTE = "/api/mcp/[serverId]/tools/[toolName]/execute" as const;
export const MCP_RESOURCE_READ_ROUTE = "/api/mcp/[serverId]/resources/read" as const;
export const MCP_EXECUTION_HISTORY_ROUTE = "/api/mcp/[serverId]/history" as const;

export const MCP_INTERACTION_MAX_BODY_BYTES = 128 * 1024;
export const MCP_TOKEN_EXPIRING_SOON_THRESHOLD_MS = 15 * 60 * 1000;

export type McpSurfaceState = "idle" | "loading" | "success" | "empty" | "stale" | "error";
export type McpTokenLifecycleState = "healthy" | "expiring_soon" | "expired" | "unknown";

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
  | "NETWORK_ERROR"
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
  NETWORK_ERROR: "connection",
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

export const MCP_SURFACE_STATE_TRANSITIONS: Record<McpSurfaceState, readonly McpSurfaceState[]> = {
  idle: ["loading", "success", "empty", "error"],
  loading: ["success", "empty", "stale", "error"],
  success: ["loading", "stale", "empty", "error"],
  empty: ["loading", "success", "error"],
  stale: ["loading", "success", "empty", "error"],
  error: ["loading", "stale", "success", "empty"],
};

export type McpErrorRemediationAction =
  | "retry"
  | "reconnect"
  | "fix_input"
  | "refresh_capabilities"
  | "check_endpoint"
  | "report_issue";

export type McpErrorRemediation = {
  action: McpErrorRemediationAction;
  label: string;
  hint: string;
};

export const MCP_INTERACTION_ERROR_REMEDIATION_BY_CODE: Record<
  McpInteractionErrorCode,
  McpErrorRemediation
> = {
  INVALID_REQUEST: {
    action: "fix_input",
    label: "Fix request",
    hint: "Review request format and submit again.",
  },
  VALIDATION_ERROR: {
    action: "fix_input",
    label: "Fix input",
    hint: "Correct invalid values before retrying.",
  },
  NETWORK_ERROR: {
    action: "check_endpoint",
    label: "Retry",
    hint: "Check network connectivity and MCP endpoint availability.",
  },
  NOT_CONNECTED: {
    action: "reconnect",
    label: "Connect",
    hint: "Connect this server before running MCP actions.",
  },
  AUTH_REQUIRED: {
    action: "reconnect",
    label: "Reconnect",
    hint: "Authentication is required to continue.",
  },
  RECONNECT_REQUIRED: {
    action: "reconnect",
    label: "Reconnect",
    hint: "Credentials are no longer recoverable with refresh.",
  },
  TOOL_NOT_FOUND: {
    action: "refresh_capabilities",
    label: "Refresh capabilities",
    hint: "Tool list may be stale for this server.",
  },
  RESOURCE_NOT_FOUND: {
    action: "refresh_capabilities",
    label: "Refresh capabilities",
    hint: "Resource list may be stale for this server.",
  },
  MCP_CONNECT_FAILED: {
    action: "check_endpoint",
    label: "Retry",
    hint: "Verify transport selection and endpoint reachability.",
  },
  EXECUTION_FAILED: {
    action: "retry",
    label: "Retry",
    hint: "Execution failed on the provider side. Retry or inspect diagnostics.",
  },
  READ_FAILED: {
    action: "retry",
    label: "Retry",
    hint: "Resource read failed on the provider side. Retry or inspect diagnostics.",
  },
  INTERNAL_ERROR: {
    action: "report_issue",
    label: "Retry",
    hint: "Unexpected error. Retry and report with diagnostics if it persists.",
  },
};

export function canTransitionMcpSurfaceState(
  fromState: McpSurfaceState,
  toState: McpSurfaceState,
) {
  return MCP_SURFACE_STATE_TRANSITIONS[fromState].includes(toState);
}

export function deriveMcpTokenLifecycleState(
  tokenExpiresAt: string | null,
  options?: {
    now?: Date;
    expiringSoonThresholdMs?: number;
  },
): McpTokenLifecycleState {
  if (!tokenExpiresAt) {
    return "unknown";
  }

  const expiresAtMs = Date.parse(tokenExpiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return "unknown";
  }

  const nowMs = (options?.now ?? new Date()).getTime();
  const expiringSoonThresholdMs =
    options?.expiringSoonThresholdMs ?? MCP_TOKEN_EXPIRING_SOON_THRESHOLD_MS;
  const deltaMs = expiresAtMs - nowMs;

  if (deltaMs <= 0) {
    return "expired";
  }

  if (deltaMs <= expiringSoonThresholdMs) {
    return "expiring_soon";
  }

  return "healthy";
}

export function getMcpErrorRemediation(
  code: McpInteractionErrorCode,
): McpErrorRemediation {
  return MCP_INTERACTION_ERROR_REMEDIATION_BY_CODE[code];
}

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
