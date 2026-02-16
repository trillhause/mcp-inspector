import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { dbQueryFirst } from "@/lib/db";
import { getTransportPreferenceOrder, type ServerTransport } from "@/lib/servers";

const MCP_CLIENT_INFO = {
  name: "mcp-auth-experiment",
  version: "0.1.0",
} as const;

type ServerRow = {
  id: string;
  mcp_url: string;
  transport: ServerTransport;
};

type CredentialRow = {
  mcp_server_id: string;
  access_token: string;
  token_expires_at: string | null;
};

export type McpTransportMode = Exclude<ServerTransport, "auto">;

export type McpConnectionContext = {
  mcp_server_id: string;
  mcp_url: string;
  configured_transport: ServerTransport;
  transport_candidates: McpTransportMode[];
  token_expires_at: string | null;
};

export type CreateMcpClientInput = {
  mcpServerId: string;
  transport?: McpTransportMode;
};

type ResolvedConnectionContext = {
  context: McpConnectionContext;
  accessToken: string;
};

export type ConnectedMcpClient = {
  client: Client;
  transport: Transport;
  connection: McpConnectionContext & {
    selected_transport: McpTransportMode;
  };
  close: () => Promise<void>;
};

export class McpClientError extends Error {
  readonly code: "NOT_CONNECTED" | "AUTH_REQUIRED" | "MCP_CONNECT_FAILED";
  readonly httpStatus: number;
  readonly details?: string[];

  constructor(
    code: McpClientError["code"],
    message: string,
    options?: {
      httpStatus?: number;
      details?: string[];
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "McpClientError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 500;
    this.details = options?.details;
  }
}

export function isMcpClientError(error: unknown): error is McpClientError {
  return error instanceof McpClientError;
}

function readServerById(mcpServerId: string) {
  return dbQueryFirst<ServerRow>(
    `SELECT
      id,
      mcp_url,
      transport
    FROM mcp_servers
    WHERE id = ?
    LIMIT 1`,
    [mcpServerId],
  );
}

function readCredentialByServerId(mcpServerId: string) {
  return dbQueryFirst<CredentialRow>(
    `SELECT
      mcp_server_id,
      access_token,
      token_expires_at
    FROM oauth_credentials
    WHERE mcp_server_id = ?
    LIMIT 1`,
    [mcpServerId],
  );
}

function mapConfiguredTransportToCandidates(configuredTransport: ServerTransport): McpTransportMode[] {
  return [...getTransportPreferenceOrder(configuredTransport)];
}

function resolveConnectionContext(mcpServerId: string): ResolvedConnectionContext {
  const server = readServerById(mcpServerId);
  if (!server) {
    throw new McpClientError("NOT_CONNECTED", "Server is not connected", {
      httpStatus: 404,
      details: ["Server not found"],
    });
  }

  const credentials = readCredentialByServerId(mcpServerId);
  if (!credentials) {
    throw new McpClientError("NOT_CONNECTED", "Server is not connected", {
      httpStatus: 409,
      details: ["OAuth credentials not found for this server"],
    });
  }

  const accessToken = credentials.access_token.trim();
  if (accessToken.length === 0) {
    throw new McpClientError("AUTH_REQUIRED", "OAuth credentials are missing a usable access token", {
      httpStatus: 401,
      details: ["Reconnect the server to obtain fresh credentials"],
    });
  }

  return {
    context: {
      mcp_server_id: server.id,
      mcp_url: server.mcp_url,
      configured_transport: server.transport,
      transport_candidates: mapConfiguredTransportToCandidates(server.transport),
      token_expires_at: credentials.token_expires_at,
    },
    accessToken,
  };
}

function createAuthenticatedRequestInit(accessToken: string): RequestInit {
  return {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  };
}

function createTransport(
  mcpUrl: string,
  transport: McpTransportMode,
  requestInit: RequestInit,
): Transport {
  const endpoint = new URL(mcpUrl);

  if (transport === "streamable_http") {
    return new StreamableHTTPClientTransport(endpoint, {
      requestInit,
    });
  }

  return new SSEClientTransport(endpoint, {
    requestInit,
  });
}

function mapConnectFailure(error: unknown, selectedTransport: McpTransportMode): McpClientError {
  const details = [`transport=${selectedTransport}`];

  if (error instanceof StreamableHTTPError || error instanceof SseError) {
    if (error.code === 401 || error.code === 403) {
      return new McpClientError("AUTH_REQUIRED", "Authentication failed while connecting to MCP server", {
        httpStatus: 401,
        details,
        cause: error,
      });
    }

    return new McpClientError("MCP_CONNECT_FAILED", "Failed to connect to MCP server", {
      httpStatus: 502,
      details,
      cause: error,
    });
  }

  if (
    error instanceof Error &&
    (error.message.toLowerCase().includes("unauthorized") ||
      error.message.toLowerCase().includes("forbidden"))
  ) {
    return new McpClientError("AUTH_REQUIRED", "Authentication failed while connecting to MCP server", {
      httpStatus: 401,
      details,
      cause: error,
    });
  }

  return new McpClientError("MCP_CONNECT_FAILED", "Failed to connect to MCP server", {
    httpStatus: 502,
    details,
    cause: error,
  });
}

export async function createMcpClientByServerId(
  input: string | CreateMcpClientInput,
): Promise<ConnectedMcpClient> {
  const mcpServerId = typeof input === "string" ? input : input.mcpServerId;
  const transportOverride = typeof input === "string" ? undefined : input.transport;
  const resolvedConnection = resolveConnectionContext(mcpServerId);
  const connection = resolvedConnection.context;
  const selectedTransport = transportOverride ?? connection.transport_candidates[0];

  if (!selectedTransport) {
    throw new McpClientError("MCP_CONNECT_FAILED", "No valid transport is configured for this server", {
      httpStatus: 500,
    });
  }

  if (!connection.transport_candidates.includes(selectedTransport)) {
    throw new McpClientError("MCP_CONNECT_FAILED", "Requested transport is not allowed for this server", {
      httpStatus: 400,
      details: [`requested_transport=${selectedTransport}`],
    });
  }

  const requestInit = createAuthenticatedRequestInit(resolvedConnection.accessToken);
  const transport = createTransport(connection.mcp_url, selectedTransport, requestInit);
  const client = new Client(MCP_CLIENT_INFO);

  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw mapConnectFailure(error, selectedTransport);
  }

  return {
    client,
    transport,
    connection: {
      ...connection,
      selected_transport: selectedTransport,
    },
    close: () => transport.close(),
  };
}
