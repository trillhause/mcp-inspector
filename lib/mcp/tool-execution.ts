import "server-only";

import type { Client } from "@modelcontextprotocol/sdk/client";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { readCachedCapabilities } from "@/lib/mcp/capabilities-store";
import { createMcpClientByServerId, isMcpClientError } from "@/lib/mcp/client";
import type {
  ExecuteToolSuccessResponse,
  McpInteractionErrorCode,
} from "@/lib/mcp/interaction-contract";

const MAX_LIST_PAGES = 25;
const MAX_SCHEMA_VALIDATION_ISSUES = 25;
const MAX_SCHEMA_VALIDATION_DEPTH = 24;

type ToolListItem = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

type JsonSchema = Record<string, unknown> | boolean;

export type ExecuteToolInput = {
  mcpServerId: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

type ResolvedToolDefinition = {
  name: string;
  inputSchema: JsonSchema | null;
};

type ToolListResult =
  | {
      supported: true;
      tools: ToolListItem[];
    }
  | {
      supported: false;
      tools: [];
    };

type ValidationContext = {
  issues: string[];
};

export class McpToolExecutionError extends Error {
  readonly code: McpInteractionErrorCode;
  readonly httpStatus: number;
  readonly details?: string[];

  constructor(
    code: McpToolExecutionError["code"],
    message: string,
    options?: {
      httpStatus?: number;
      details?: string[];
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "McpToolExecutionError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 500;
    this.details = options?.details;
  }
}

export function isMcpToolExecutionError(error: unknown): error is McpToolExecutionError {
  return error instanceof McpToolExecutionError;
}

function logToolExecutionEvent(
  level: "info" | "warn" | "error",
  event: string,
  context: Record<string, unknown>,
) {
  const message = `[mcp-tool-execution] ${event}`;
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

function hasReconnectRequiredDetail(details: string[] | undefined) {
  if (!details || details.length === 0) {
    return false;
  }

  return details.some((detail) => detail.toLowerCase().includes("reconnect_required=true"));
}

function mapMcpClientError(error: unknown): McpToolExecutionError {
  if (!isMcpClientError(error)) {
    return new McpToolExecutionError("INTERNAL_ERROR", "Unexpected MCP session error", {
      httpStatus: 500,
      cause: error,
    });
  }

  if (error.code === "AUTH_REQUIRED" && hasReconnectRequiredDetail(error.details)) {
    return new McpToolExecutionError("RECONNECT_REQUIRED", "Reconnect is required before executing tools", {
      httpStatus: 401,
      details: error.details,
      cause: error,
    });
  }

  if (error.code === "NOT_CONNECTED") {
    return new McpToolExecutionError("NOT_CONNECTED", error.message, {
      httpStatus: error.httpStatus,
      details: error.details,
      cause: error,
    });
  }

  if (error.code === "AUTH_REQUIRED") {
    return new McpToolExecutionError("AUTH_REQUIRED", error.message, {
      httpStatus: error.httpStatus,
      details: error.details,
      cause: error,
    });
  }

  return new McpToolExecutionError("MCP_CONNECT_FAILED", error.message, {
    httpStatus: error.httpStatus,
    details: error.details,
    cause: error,
  });
}

function normalizeInputSchema(value: unknown): JsonSchema | null {
  if (value === true || value === false) {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getCachedToolDefinition(mcpServerId: string, toolName: string): ResolvedToolDefinition | null {
  const cached = readCachedCapabilities(mcpServerId);
  if (!cached) {
    return null;
  }

  const tool = cached.tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return null;
  }

  return {
    name: tool.name,
    inputSchema: normalizeInputSchema(tool.inputSchema),
  };
}

function isUnsupportedToolsListError(error: unknown) {
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

function normalizeCursor(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function listToolsForValidation(mcpServerId: string, client: Client): Promise<ToolListResult> {
  const tools: ToolListItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined = undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    let response: Awaited<ReturnType<Client["listTools"]>>;
    try {
      response = await client.listTools(cursor ? { cursor } : undefined);
    } catch (error) {
      if (isUnsupportedToolsListError(error)) {
        return {
          supported: false,
          tools: [],
        };
      }

      throw new McpToolExecutionError("EXECUTION_FAILED", "Failed to load tool definitions for validation", {
        httpStatus: 502,
        details: [`mcp_server_id=${mcpServerId}`],
        cause: error,
      });
    }

    tools.push(...response.tools);
    const nextCursor = normalizeCursor(response.nextCursor);

    if (!nextCursor) {
      return {
        supported: true,
        tools,
      };
    }

    if (seenCursors.has(nextCursor)) {
      throw new McpToolExecutionError("EXECUTION_FAILED", "Tool discovery cursor loop detected", {
        httpStatus: 502,
        details: [`mcp_server_id=${mcpServerId}`],
      });
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new McpToolExecutionError("EXECUTION_FAILED", "Tool discovery exceeded pagination limit", {
    httpStatus: 502,
    details: [`mcp_server_id=${mcpServerId}`, `max_pages=${MAX_LIST_PAGES}`],
  });
}

async function resolveToolDefinition(
  mcpServerId: string,
  toolName: string,
  client: Client,
): Promise<ResolvedToolDefinition> {
  const cached = getCachedToolDefinition(mcpServerId, toolName);
  if (cached) {
    return cached;
  }

  const liveTools = await listToolsForValidation(mcpServerId, client);
  if (!liveTools.supported) {
    throw new McpToolExecutionError(
      "VALIDATION_ERROR",
      "Tool validation requires tools/list support or cached capabilities",
      {
        httpStatus: 422,
        details: [`tool_name=${toolName}`],
      },
    );
  }

  const tool = liveTools.tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    throw new McpToolExecutionError("TOOL_NOT_FOUND", "Requested tool was not found on this server", {
      httpStatus: 404,
      details: [`tool_name=${toolName}`],
    });
  }

  return {
    name: tool.name,
    inputSchema: normalizeInputSchema(tool.inputSchema),
  };
}

function deepEqualSerializable(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function pushIssue(context: ValidationContext, issue: string) {
  if (context.issues.length >= MAX_SCHEMA_VALIDATION_ISSUES) {
    return;
  }
  context.issues.push(issue);
}

function joinPath(path: string, key: string) {
  return path.length === 0 ? key : `${path}.${key}`;
}

function isSchemaRecord(schema: unknown): schema is Record<string, unknown> {
  return !!schema && typeof schema === "object" && !Array.isArray(schema);
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  const collected: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      collected.push(item);
    }
  }
  return collected;
}

function matchesType(value: unknown, expectedType: string) {
  if (expectedType === "null") {
    return value === null;
  }
  if (expectedType === "string") {
    return typeof value === "string";
  }
  if (expectedType === "boolean") {
    return typeof value === "boolean";
  }
  if (expectedType === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (expectedType === "integer") {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
  }
  if (expectedType === "array") {
    return Array.isArray(value);
  }
  if (expectedType === "object") {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  return true;
}

function validateStringKeywords(
  value: string,
  schema: Record<string, unknown>,
  path: string,
  context: ValidationContext,
) {
  const minLength =
    typeof schema.minLength === "number" && Number.isFinite(schema.minLength)
      ? schema.minLength
      : null;
  const maxLength =
    typeof schema.maxLength === "number" && Number.isFinite(schema.maxLength)
      ? schema.maxLength
      : null;

  if (minLength !== null && value.length < minLength) {
    pushIssue(context, `${path} must have at least ${minLength} characters`);
  }
  if (maxLength !== null && value.length > maxLength) {
    pushIssue(context, `${path} must have at most ${maxLength} characters`);
  }

  if (typeof schema.pattern === "string") {
    try {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        pushIssue(context, `${path} does not match required pattern`);
      }
    } catch {
      // Ignore invalid regex in external schemas.
    }
  }
}

function validateNumberKeywords(
  value: number,
  schema: Record<string, unknown>,
  path: string,
  context: ValidationContext,
) {
  const minimum = typeof schema.minimum === "number" ? schema.minimum : null;
  const maximum = typeof schema.maximum === "number" ? schema.maximum : null;
  const exclusiveMinimum =
    typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum : null;
  const exclusiveMaximum =
    typeof schema.exclusiveMaximum === "number" ? schema.exclusiveMaximum : null;

  if (minimum !== null && value < minimum) {
    pushIssue(context, `${path} must be >= ${minimum}`);
  }
  if (maximum !== null && value > maximum) {
    pushIssue(context, `${path} must be <= ${maximum}`);
  }
  if (exclusiveMinimum !== null && value <= exclusiveMinimum) {
    pushIssue(context, `${path} must be > ${exclusiveMinimum}`);
  }
  if (exclusiveMaximum !== null && value >= exclusiveMaximum) {
    pushIssue(context, `${path} must be < ${exclusiveMaximum}`);
  }
}

function validateArrayKeywords(
  value: unknown[],
  schema: Record<string, unknown>,
  path: string,
  depth: number,
  context: ValidationContext,
) {
  const minItems = typeof schema.minItems === "number" ? schema.minItems : null;
  const maxItems = typeof schema.maxItems === "number" ? schema.maxItems : null;

  if (minItems !== null && value.length < minItems) {
    pushIssue(context, `${path} must contain at least ${minItems} items`);
  }
  if (maxItems !== null && value.length > maxItems) {
    pushIssue(context, `${path} must contain at most ${maxItems} items`);
  }

  if (Array.isArray(schema.items)) {
    const tupleSchemas = schema.items;
    for (let index = 0; index < value.length && index < tupleSchemas.length; index += 1) {
      validateAgainstSchema(value[index], tupleSchemas[index], `${path}[${index}]`, depth + 1, context);
    }
    return;
  }

  if (schema.items !== undefined) {
    for (let index = 0; index < value.length; index += 1) {
      validateAgainstSchema(value[index], schema.items, `${path}[${index}]`, depth + 1, context);
    }
  }
}

function validateObjectKeywords(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string,
  depth: number,
  context: ValidationContext,
) {
  const required = getStringArray(schema.required);
  if (required) {
    for (const propertyName of required) {
      if (!(propertyName in value)) {
        pushIssue(context, `${joinPath(path, propertyName)} is required`);
      }
    }
  }

  const properties =
    isSchemaRecord(schema.properties) && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : null;

  if (properties) {
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (propertyName in value) {
        validateAgainstSchema(
          value[propertyName],
          propertySchema,
          joinPath(path, propertyName),
          depth + 1,
          context,
        );
      }
    }
  }

  const additionalProperties = schema.additionalProperties;
  for (const [propertyName, propertyValue] of Object.entries(value)) {
    if (properties && propertyName in properties) {
      continue;
    }

    if (additionalProperties === false) {
      pushIssue(context, `${joinPath(path, propertyName)} is not allowed`);
      continue;
    }

    if (additionalProperties !== undefined && additionalProperties !== true) {
      validateAgainstSchema(
        propertyValue,
        additionalProperties,
        joinPath(path, propertyName),
        depth + 1,
        context,
      );
    }
  }
}

function validateComposedSchemas(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  depth: number,
  context: ValidationContext,
) {
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    for (const branchSchema of schema.allOf) {
      validateAgainstSchema(value, branchSchema, path, depth + 1, context);
      if (context.issues.length >= MAX_SCHEMA_VALIDATION_ISSUES) {
        return;
      }
    }
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const branchPassed = schema.anyOf.some((branchSchema) => {
      const branchContext: ValidationContext = { issues: [] };
      validateAgainstSchema(value, branchSchema, path, depth + 1, branchContext);
      return branchContext.issues.length === 0;
    });

    if (!branchPassed) {
      pushIssue(context, `${path} must satisfy at least one allowed schema`);
    }
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    let matches = 0;
    for (const branchSchema of schema.oneOf) {
      const branchContext: ValidationContext = { issues: [] };
      validateAgainstSchema(value, branchSchema, path, depth + 1, branchContext);
      if (branchContext.issues.length === 0) {
        matches += 1;
      }
    }

    if (matches !== 1) {
      pushIssue(context, `${path} must satisfy exactly one schema variant`);
    }
  }
}

function validateAgainstSchema(
  value: unknown,
  schema: unknown,
  path: string,
  depth: number,
  context: ValidationContext,
) {
  if (context.issues.length >= MAX_SCHEMA_VALIDATION_ISSUES) {
    return;
  }

  if (depth > MAX_SCHEMA_VALIDATION_DEPTH) {
    return;
  }

  if (schema === true || schema === undefined || schema === null) {
    return;
  }

  if (schema === false) {
    pushIssue(context, `${path} is not allowed`);
    return;
  }

  if (!isSchemaRecord(schema)) {
    return;
  }

  validateComposedSchemas(value, schema, path, depth, context);
  if (context.issues.length >= MAX_SCHEMA_VALIDATION_ISSUES) {
    return;
  }

  const typeValue = schema.type;
  const expectedTypes =
    typeof typeValue === "string"
      ? [typeValue]
      : Array.isArray(typeValue)
        ? typeValue.filter((item): item is string => typeof item === "string")
        : [];

  if (expectedTypes.length > 0) {
    const matches = expectedTypes.some((expectedType) => matchesType(value, expectedType));
    if (!matches) {
      pushIssue(context, `${path} must be ${expectedTypes.join(" or ")}`);
      return;
    }
  }

  if ("const" in schema && !deepEqualSerializable(value, schema.const)) {
    pushIssue(context, `${path} must match the required constant value`);
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const matchedEnum = schema.enum.some((candidate) => deepEqualSerializable(candidate, value));
    if (!matchedEnum) {
      pushIssue(context, `${path} must match one of the allowed enum values`);
    }
  }

  if (typeof value === "string") {
    validateStringKeywords(value, schema, path, context);
    return;
  }

  if (typeof value === "number") {
    validateNumberKeywords(value, schema, path, context);
    return;
  }

  if (Array.isArray(value)) {
    validateArrayKeywords(value, schema, path, depth, context);
    return;
  }

  if (value && typeof value === "object") {
    validateObjectKeywords(value as Record<string, unknown>, schema, path, depth, context);
  }
}

function validateToolArguments(argumentsValue: Record<string, unknown>, schema: JsonSchema | null) {
  if (schema === null || schema === true) {
    return [];
  }

  if (schema === false) {
    return ["arguments are not accepted by this tool"];
  }

  const context: ValidationContext = {
    issues: [],
  };
  validateAgainstSchema(argumentsValue, schema, "arguments", 0, context);
  return context.issues;
}

function sanitizeErrorDetail(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function isUnknownToolMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unknown tool") ||
    normalized.includes("tool not found") ||
    normalized.includes("no such tool") ||
    normalized.includes("unrecognized tool")
  );
}

function mapCallToolFailure(error: unknown, toolName: string): McpToolExecutionError {
  if (error instanceof McpError) {
    if (isUnknownToolMessage(error.message)) {
      return new McpToolExecutionError("TOOL_NOT_FOUND", "Requested tool was not found on this server", {
        httpStatus: 404,
        details: [`tool_name=${toolName}`],
        cause: error,
      });
    }

    if (error.code === ErrorCode.InvalidParams || error.code === ErrorCode.InvalidRequest) {
      return new McpToolExecutionError("VALIDATION_ERROR", "Tool arguments were rejected by the MCP server", {
        httpStatus: 422,
        details: [sanitizeErrorDetail(error.message)],
        cause: error,
      });
    }
  }

  if (error instanceof Error && isUnknownToolMessage(error.message)) {
    return new McpToolExecutionError("TOOL_NOT_FOUND", "Requested tool was not found on this server", {
      httpStatus: 404,
      details: [`tool_name=${toolName}`],
      cause: error,
    });
  }

  return new McpToolExecutionError("EXECUTION_FAILED", "MCP tool execution failed", {
    httpStatus: 502,
    cause: error,
  });
}

function collectToolResultErrorDetails(result: CallToolResult) {
  if (!("content" in result) || !Array.isArray(result.content)) {
    return ["tool returned an error result payload"];
  }

  const details: string[] = [];
  for (const item of result.content) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      const normalized = sanitizeErrorDetail(candidate.text);
      if (normalized) {
        details.push(normalized);
      }
    }
  }

  if (details.length === 0) {
    details.push("tool returned an error result payload");
  }

  return details.slice(0, 3);
}

function toJsonSafeValue(value: unknown) {
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, candidate) =>
        typeof candidate === "bigint" ? candidate.toString() : candidate,
      ),
    ) as unknown;
  } catch {
    return {
      serialization_warning: "result could not be fully serialized",
    };
  }
}

function isToolErrorResult(result: CallToolResult) {
  return "isError" in result && result.isError === true;
}

export async function executeTool(input: ExecuteToolInput): Promise<ExecuteToolSuccessResponse> {
  const startedAt = Date.now();
  let session: Awaited<ReturnType<typeof createMcpClientByServerId>> | null = null;

  try {
    session = await createMcpClientByServerId(input.mcpServerId);
  } catch (error) {
    const mapped = mapMcpClientError(error);
    logToolExecutionEvent("warn", "session_open_failed", {
      mcp_server_id: input.mcpServerId,
      tool_name: input.toolName,
      code: mapped.code,
    });
    throw mapped;
  }

  try {
    const tool = await resolveToolDefinition(input.mcpServerId, input.toolName, session.client);
    const validationIssues = validateToolArguments(input.arguments, tool.inputSchema);

    if (validationIssues.length > 0) {
      throw new McpToolExecutionError("VALIDATION_ERROR", "Tool arguments failed validation", {
        httpStatus: 422,
        details: validationIssues.slice(0, MAX_SCHEMA_VALIDATION_ISSUES),
      });
    }

    let rawResult: CallToolResult;
    try {
      rawResult = await session.client.callTool({
        name: tool.name,
        arguments: input.arguments,
      });
    } catch (error) {
      throw mapCallToolFailure(error, tool.name);
    }

    if (isToolErrorResult(rawResult)) {
      throw new McpToolExecutionError("EXECUTION_FAILED", "Tool execution returned an error result", {
        httpStatus: 502,
        details: collectToolResultErrorDetails(rawResult),
      });
    }

    const response: ExecuteToolSuccessResponse = {
      mcp_server_id: input.mcpServerId,
      target: {
        type: "tool",
        tool_name: tool.name,
      },
      status: "success",
      latency_ms: Date.now() - startedAt,
      content_type: "application/json",
      executed_at: new Date().toISOString(),
      result: toJsonSafeValue(rawResult),
    };

    logToolExecutionEvent("info", "tool_executed", {
      mcp_server_id: input.mcpServerId,
      tool_name: tool.name,
      latency_ms: response.latency_ms,
      selected_transport: session.connection.selected_transport,
      refreshed_before_connect: session.connection.refreshed_before_connect,
    });

    return response;
  } catch (error) {
    if (isMcpToolExecutionError(error)) {
      logToolExecutionEvent("warn", "tool_execution_failed", {
        mcp_server_id: input.mcpServerId,
        tool_name: input.toolName,
        code: error.code,
      });
      throw error;
    }

    logToolExecutionEvent("error", "tool_execution_unexpected_failure", {
      mcp_server_id: input.mcpServerId,
      tool_name: input.toolName,
    });

    throw new McpToolExecutionError("INTERNAL_ERROR", "Unexpected tool execution failure", {
      httpStatus: 500,
      cause: error,
    });
  } finally {
    if (session) {
      await session.close().catch(() => undefined);
    }
  }
}
