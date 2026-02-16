import "server-only";

import type { Client } from "@modelcontextprotocol/sdk/client";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import {
  createMcpClientByServerId,
  type McpTransportMode,
} from "@/lib/mcp/client";
import type { ServerTransport } from "@/lib/servers";

const MAX_LIST_PAGES = 25;

type ToolListItem = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type ResourceListItem = Awaited<ReturnType<Client["listResources"]>>["resources"][number];
type PromptListItem = Awaited<ReturnType<Client["listPrompts"]>>["prompts"][number];

type ListOutcome<T> = {
  items: T[];
  supported: boolean;
};

export type DiscoveredTool = {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
};

export type DiscoveredResource = {
  uri: string;
  name: string;
  description: string | null;
  mimeType: string | null;
};

export type DiscoveredPrompt = {
  name: string;
  description: string | null;
  arguments: Array<{
    name: string;
    description: string | null;
    required: boolean;
  }>;
};

export type DiscoverySupport = {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
};

export type DiscoveryTransportMetadata = {
  configured: ServerTransport;
  selected: McpTransportMode;
  attempted: McpTransportMode[];
  candidates: McpTransportMode[];
  refreshed_before_connect: boolean;
};

export type DiscoveredCapabilities = {
  mcp_server_id: string;
  discovered_at: string;
  token_expires_at: string | null;
  transport: DiscoveryTransportMetadata;
  support: DiscoverySupport;
  tools: DiscoveredTool[];
  resources: DiscoveredResource[];
  prompts?: DiscoveredPrompt[];
  warnings?: string[];
};

export class McpCapabilityDiscoveryError extends Error {
  readonly code: "CAPABILITY_DISCOVERY_FAILED";
  readonly httpStatus: number;
  readonly details?: string[];

  constructor(
    message: string,
    options?: {
      httpStatus?: number;
      details?: string[];
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "McpCapabilityDiscoveryError";
    this.code = "CAPABILITY_DISCOVERY_FAILED";
    this.httpStatus = options?.httpStatus ?? 502;
    this.details = options?.details;
  }
}

export function isMcpCapabilityDiscoveryError(error: unknown): error is McpCapabilityDiscoveryError {
  return error instanceof McpCapabilityDiscoveryError;
}

function logDiscoveryEvent(
  level: "info" | "warn" | "error",
  event: string,
  context: Record<string, unknown>,
) {
  const message = `[mcp-discovery] ${event}`;

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

function normalizeRequiredString(value: unknown, fallback: string) {
  return normalizeOptionalString(value) ?? fallback;
}

function serializeJsonObject(value: unknown, fallback: Record<string, unknown>) {
  try {
    const serialized = JSON.parse(JSON.stringify(value));
    if (!serialized || typeof serialized !== "object" || Array.isArray(serialized)) {
      return fallback;
    }

    return serialized as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function isUnsupportedMethodError(error: unknown, methodName: string) {
  const normalizedMethod = methodName.toLowerCase();

  if (error instanceof McpError) {
    if (error.code === ErrorCode.MethodNotFound) {
      return true;
    }

    if (error.code === ErrorCode.InvalidRequest) {
      const message = error.message.toLowerCase();
      return (
        message.includes("method not found") ||
        message.includes("unknown method") ||
        message.includes("not supported") ||
        message.includes(normalizedMethod)
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

function getPagedCursor(nextCursor: unknown) {
  if (typeof nextCursor !== "string") {
    return null;
  }

  const trimmed = nextCursor.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function listWithPagination<T>(
  mcpServerId: string,
  methodName: string,
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{
    items: T[];
    nextCursor?: string;
  }>,
): Promise<ListOutcome<T>> {
  const items: T[] = [];
  const cursorsSeen = new Set<string>();
  let cursor: string | undefined = undefined;
  let page = 0;

  while (page < MAX_LIST_PAGES) {
    page += 1;

    try {
      const result = await fetchPage(cursor);
      items.push(...result.items);

      const nextCursor = getPagedCursor(result.nextCursor);
      if (!nextCursor) {
        return {
          items,
          supported: true,
        };
      }

      if (cursorsSeen.has(nextCursor)) {
        throw new McpCapabilityDiscoveryError("MCP capability pagination cursor loop detected", {
          details: [
            `mcp_server_id=${mcpServerId}`,
            `method=${methodName}`,
            `cursor=${nextCursor}`,
          ],
        });
      }

      cursorsSeen.add(nextCursor);
      cursor = nextCursor;
    } catch (error) {
      if (isUnsupportedMethodError(error, methodName)) {
        logDiscoveryEvent("warn", "capability_method_unsupported", {
          mcp_server_id: mcpServerId,
          method: methodName,
        });

        return {
          items: [],
          supported: false,
        };
      }

      if (isMcpCapabilityDiscoveryError(error)) {
        throw error;
      }

      throw new McpCapabilityDiscoveryError(`Failed to list capabilities via ${methodName}`, {
        details: [`mcp_server_id=${mcpServerId}`, `method=${methodName}`],
        cause: error,
      });
    }
  }

  throw new McpCapabilityDiscoveryError("MCP capability pagination exceeded maximum page limit", {
    details: [
      `mcp_server_id=${mcpServerId}`,
      `method=${methodName}`,
      `max_pages=${MAX_LIST_PAGES}`,
    ],
  });
}

async function listTools(mcpServerId: string, client: Client) {
  return listWithPagination<ToolListItem>(mcpServerId, "tools/list", async (cursor) => {
    const response = await client.listTools(cursor ? { cursor } : undefined);
    return {
      items: response.tools,
      nextCursor: response.nextCursor,
    };
  });
}

async function listResources(mcpServerId: string, client: Client) {
  return listWithPagination<ResourceListItem>(mcpServerId, "resources/list", async (cursor) => {
    const response = await client.listResources(cursor ? { cursor } : undefined);
    return {
      items: response.resources,
      nextCursor: response.nextCursor,
    };
  });
}

async function listPrompts(mcpServerId: string, client: Client) {
  return listWithPagination<PromptListItem>(mcpServerId, "prompts/list", async (cursor) => {
    const response = await client.listPrompts(cursor ? { cursor } : undefined);
    return {
      items: response.prompts,
      nextCursor: response.nextCursor,
    };
  });
}

function normalizeTool(tool: ToolListItem, index: number): DiscoveredTool {
  return {
    name: normalizeRequiredString(tool.name, `tool_${index + 1}`),
    description: normalizeOptionalString(tool.description),
    inputSchema: serializeJsonObject(tool.inputSchema, { type: "object" }),
  };
}

function normalizeResource(resource: ResourceListItem, index: number): DiscoveredResource {
  return {
    uri: normalizeRequiredString(resource.uri, `resource://${index + 1}`),
    name: normalizeRequiredString(resource.name, `Resource ${index + 1}`),
    description: normalizeOptionalString(resource.description),
    mimeType: normalizeOptionalString(resource.mimeType),
  };
}

function normalizePrompt(prompt: PromptListItem, index: number): DiscoveredPrompt {
  return {
    name: normalizeRequiredString(prompt.name, `prompt_${index + 1}`),
    description: normalizeOptionalString(prompt.description),
    arguments: (prompt.arguments ?? []).map((argument, argumentIndex) => ({
      name: normalizeRequiredString(argument.name, `arg_${argumentIndex + 1}`),
      description: normalizeOptionalString(argument.description),
      required: argument.required === true,
    })),
  };
}

export type DiscoverCapabilitiesInput = {
  mcpServerId: string;
};

export async function discoverCapabilities(
  input: string | DiscoverCapabilitiesInput,
): Promise<DiscoveredCapabilities> {
  const mcpServerId = typeof input === "string" ? input : input.mcpServerId;
  const session = await createMcpClientByServerId(mcpServerId);

  try {
    const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
      listTools(mcpServerId, session.client),
      listResources(mcpServerId, session.client),
      listPrompts(mcpServerId, session.client),
    ]);

    const tools = toolsResult.items.map(normalizeTool);
    const resources = resourcesResult.items.map(normalizeResource);
    const prompts = promptsResult.items.map(normalizePrompt);

    const warnings: string[] = [];
    if (!toolsResult.supported) {
      warnings.push("tools_unsupported");
    }
    if (!resourcesResult.supported) {
      warnings.push("resources_unsupported");
    }
    if (!promptsResult.supported) {
      warnings.push("prompts_unsupported");
    }

    const discoveredAt = new Date().toISOString();
    const capabilities: DiscoveredCapabilities = {
      mcp_server_id: mcpServerId,
      discovered_at: discoveredAt,
      token_expires_at: session.connection.token_expires_at,
      transport: {
        configured: session.connection.configured_transport,
        selected: session.connection.selected_transport,
        attempted: [...session.connection.attempted_transports],
        candidates: [...session.connection.transport_candidates],
        refreshed_before_connect: session.connection.refreshed_before_connect,
      },
      support: {
        tools: toolsResult.supported,
        resources: resourcesResult.supported,
        prompts: promptsResult.supported,
      },
      tools,
      resources,
      ...(promptsResult.supported ? { prompts } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    logDiscoveryEvent("info", "capabilities_discovered", {
      mcp_server_id: mcpServerId,
      tools_count: tools.length,
      resources_count: resources.length,
      prompts_count: promptsResult.supported ? prompts.length : null,
      selected_transport: session.connection.selected_transport,
      attempted_transports: session.connection.attempted_transports.join(","),
      refreshed_before_connect: session.connection.refreshed_before_connect,
    });

    return capabilities;
  } finally {
    await session.close().catch(() => undefined);
  }
}
