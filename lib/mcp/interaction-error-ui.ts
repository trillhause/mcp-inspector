import {
  MCP_INTERACTION_ERROR_CATEGORY_BY_CODE,
  getMcpErrorRemediation,
  type McpErrorRemediation,
  type McpInteractionErrorCategory,
  type McpInteractionErrorCode,
} from "@/lib/mcp/interaction-contract";

const KNOWN_CODES: readonly McpInteractionErrorCode[] = [
  "INVALID_REQUEST",
  "VALIDATION_ERROR",
  "NETWORK_ERROR",
  "NOT_CONNECTED",
  "AUTH_REQUIRED",
  "RECONNECT_REQUIRED",
  "TOOL_NOT_FOUND",
  "RESOURCE_NOT_FOUND",
  "MCP_CONNECT_FAILED",
  "EXECUTION_FAILED",
  "READ_FAILED",
  "INTERNAL_ERROR",
] as const;

const KNOWN_CATEGORIES: readonly McpInteractionErrorCategory[] = [
  "validation",
  "auth",
  "connection",
  "not_found",
  "execution",
  "internal",
] as const;

export type McpSurfaceError = {
  code: McpInteractionErrorCode;
  category: McpInteractionErrorCategory;
  message: string;
  details: string[];
  rawCode: string | null;
  rawCategory: string | null;
};

export type McpSurfaceErrorHandlers = {
  retry?: () => void;
  reconnect?: () => void;
  fixInput?: () => void;
  refreshCapabilities?: () => void;
  checkEndpoint?: () => void;
  reportIssue?: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDetails(details: unknown) {
  if (!Array.isArray(details)) {
    return [];
  }

  return details
    .map((detail) => normalizeOptionalString(detail))
    .filter((detail): detail is string => Boolean(detail));
}

function toKnownCode(value: string | null): McpInteractionErrorCode | null {
  if (!value) {
    return null;
  }

  return KNOWN_CODES.includes(value as McpInteractionErrorCode)
    ? (value as McpInteractionErrorCode)
    : null;
}

function toKnownCategory(value: string | null): McpInteractionErrorCategory | null {
  if (!value) {
    return null;
  }

  return KNOWN_CATEGORIES.includes(value as McpInteractionErrorCategory)
    ? (value as McpInteractionErrorCategory)
    : null;
}

function resolveErrorPayload(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (isRecord(payload.error)) {
    return payload.error;
  }

  return payload;
}

export function normalizeMcpSurfaceError(
  payload: unknown,
  options?: {
    fallbackCode?: McpInteractionErrorCode;
    fallbackMessage?: string;
    extraDetails?: string[];
  },
): McpSurfaceError {
  const fallbackCode = options?.fallbackCode ?? "INTERNAL_ERROR";
  const fallbackMessage = options?.fallbackMessage ?? "Request failed";
  const extraDetails = options?.extraDetails ?? [];
  const resolvedErrorPayload = resolveErrorPayload(payload);

  const rawCode = normalizeOptionalString(resolvedErrorPayload?.code);
  const code = toKnownCode(rawCode) ?? fallbackCode;

  const rawCategory = normalizeOptionalString(resolvedErrorPayload?.category);
  const category = toKnownCategory(rawCategory) ?? MCP_INTERACTION_ERROR_CATEGORY_BY_CODE[code];

  const message =
    normalizeOptionalString(resolvedErrorPayload?.message) ?? fallbackMessage;

  const details = normalizeDetails(resolvedErrorPayload?.details);
  const combinedDetails = [...details, ...extraDetails];

  if (rawCode && toKnownCode(rawCode) === null) {
    combinedDetails.push(`unmapped_error_code=${rawCode}`);
  }
  if (rawCategory && toKnownCategory(rawCategory) === null) {
    combinedDetails.push(`unmapped_error_category=${rawCategory}`);
  }

  return {
    code,
    category,
    message,
    details: combinedDetails,
    rawCode,
    rawCategory,
  };
}

export function resolveMcpSurfaceErrorAction(
  error: McpSurfaceError,
  handlers: McpSurfaceErrorHandlers,
): McpErrorRemediation & {
  onClick: (() => void) | null;
} {
  const remediation = getMcpErrorRemediation(error.code);

  if (remediation.action === "retry") {
    return { ...remediation, onClick: handlers.retry ?? null };
  }

  if (remediation.action === "reconnect") {
    return { ...remediation, onClick: handlers.reconnect ?? null };
  }

  if (remediation.action === "fix_input") {
    return { ...remediation, onClick: handlers.fixInput ?? null };
  }

  if (remediation.action === "refresh_capabilities") {
    return { ...remediation, onClick: handlers.refreshCapabilities ?? null };
  }

  if (remediation.action === "check_endpoint") {
    return {
      ...remediation,
      onClick: handlers.checkEndpoint ?? handlers.retry ?? null,
    };
  }

  return {
    ...remediation,
    onClick: handlers.reportIssue ?? handlers.retry ?? null,
  };
}

export function buildMcpSurfaceErrorDiagnostics(
  error: McpSurfaceError,
  context: Record<string, unknown>,
) {
  return JSON.stringify(
    {
      code: error.code,
      category: error.category,
      raw_code: error.rawCode,
      raw_category: error.rawCategory,
      message: error.message,
      details: error.details,
      ...context,
    },
    null,
    2,
  );
}
