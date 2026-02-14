import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { dbQueryFirst } from "@/lib/db";
import { OAuthRefreshError, refreshOAuthCredential } from "@/lib/oauth/refresh";
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
    attempted_transports: McpTransportMode[];
    refreshed_before_connect: boolean;
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

function logMcpSessionEvent(
  level: "info" | "warn" | "error",
  event: string,
  context: Record<string, unknown>,
) {
  const message = `[mcp-session] ${event}`;

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

function addDiagnosticDetails(details: string[] | undefined, extra: string[]) {
  const merged = [...(details ?? []), ...extra];
  return merged.length > 0 ? merged : undefined;
}

function withSessionDiagnostics(error: McpClientError, extra: string[]) {
  return new McpClientError(error.code, error.message, {
    httpStatus: error.httpStatus,
    details: addDiagnosticDetails(error.details, extra),
    cause: error,
  });
}

async function connectWithTransport(
  context: McpConnectionContext,
  accessToken: string,
  selectedTransport: McpTransportMode,
): Promise<ConnectedMcpClient> {
  const requestInit = createAuthenticatedRequestInit(accessToken);
  const transport = createTransport(context.mcp_url, selectedTransport, requestInit);
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
      ...context,
      selected_transport: selectedTransport,
      attempted_transports: [selectedTransport],
      refreshed_before_connect: false,
    },
    close: () => transport.close(),
  };
}

async function refreshBeforeConnect(mcpServerId: string) {
  try {
    const result = await refreshOAuthCredential({
      mcpServerId,
    });

    if (result.status === "reconnect_required") {
      throw new McpClientError(
        "AUTH_REQUIRED",
        "Stored credentials require reconnect before opening an MCP session",
        {
          httpStatus: 401,
          details: [
            "reconnect_required=true",
            `refresh_reason=${result.refresh_reason}`,
            "Reconnect the server to continue",
          ],
        },
      );
    }

    return {
      refreshed: result.refreshed,
      refreshReason: result.refresh_reason,
    };
  } catch (error) {
    if (error instanceof McpClientError) {
      throw error;
    }

    if (error instanceof OAuthRefreshError) {
      if (error.code === "NOT_CONNECTED") {
        throw new McpClientError("NOT_CONNECTED", "Server is not connected", {
          httpStatus: 409,
          details: ["OAuth credentials not found for this server"],
          cause: error,
        });
      }

      // Refresh endpoint failures are logged, but we still attempt session bootstrap with the current token.
      logMcpSessionEvent("warn", "preconnect_refresh_failed", {
        mcp_server_id: mcpServerId,
        code: error.code,
        http_status: error.httpStatus,
      });
      return {
        refreshed: false,
        refreshReason: null as string | null,
      };
    }

    throw error;
  }
}

async function refreshAndRetryOnAuthFailure(
  mcpServerId: string,
  selectedTransport: McpTransportMode,
) {
  try {
    const result = await refreshOAuthCredential({
      mcpServerId,
      force: true,
    });

    if (result.status === "reconnect_required") {
      throw new McpClientError("AUTH_REQUIRED", "Authentication requires reconnect", {
        httpStatus: 401,
        details: [
          `transport=${selectedTransport}`,
          "reconnect_required=true",
          `refresh_reason=${result.refresh_reason}`,
        ],
      });
    }

    return;
  } catch (error) {
    if (error instanceof McpClientError) {
      throw error;
    }

    if (error instanceof OAuthRefreshError) {
      if (error.code === "NOT_CONNECTED") {
        throw new McpClientError("NOT_CONNECTED", "Server is not connected", {
          httpStatus: 409,
          details: ["OAuth credentials not found for this server"],
          cause: error,
        });
      }

      throw new McpClientError("AUTH_REQUIRED", "Authentication failed while refreshing credentials", {
        httpStatus: 401,
        details: addDiagnosticDetails(error.details, [`transport=${selectedTransport}`]),
        cause: error,
      });
    }

    throw error;
  }
}

export async function createMcpClientByServerId(
  input: string | CreateMcpClientInput,
): Promise<ConnectedMcpClient> {
  const mcpServerId = typeof input === "string" ? input : input.mcpServerId;
  const transportOverride = typeof input === "string" ? undefined : input.transport;
  const initialConnection = resolveConnectionContext(mcpServerId);
  const configuredConnection = initialConnection.context;
  const selectedTransport = transportOverride ?? configuredConnection.transport_candidates[0];

  if (!selectedTransport) {
    throw new McpClientError("MCP_CONNECT_FAILED", "No valid transport is configured for this server", {
      httpStatus: 500,
    });
  }

  if (!configuredConnection.transport_candidates.includes(selectedTransport)) {
    throw new McpClientError("MCP_CONNECT_FAILED", "Requested transport is not allowed for this server", {
      httpStatus: 400,
      details: [`requested_transport=${selectedTransport}`],
    });
  }

  const preConnectRefresh = await refreshBeforeConnect(mcpServerId);
  const baseConnection = resolveConnectionContext(mcpServerId);
  const candidateTransports = transportOverride
    ? [transportOverride]
    : [...baseConnection.context.transport_candidates];
  const attemptedTransports: McpTransportMode[] = [];
  let forcedAuthRetryUsed = false;
  let lastConnectFailure: McpClientError | null = null;

  for (let index = 0; index < candidateTransports.length; index += 1) {
    const candidateTransport = candidateTransports[index];
    if (!candidateTransport) {
      continue;
    }

    attemptedTransports.push(candidateTransport);
    const isFallbackAttempt = index > 0;
    if (isFallbackAttempt) {
      logMcpSessionEvent("warn", "transport_fallback_attempt", {
        mcp_server_id: mcpServerId,
        selected_transport: candidateTransport,
        attempted_transports: attemptedTransports.join(","),
      });
    }

    const currentConnection = resolveConnectionContext(mcpServerId);

    try {
      const session = await connectWithTransport(
        currentConnection.context,
        currentConnection.accessToken,
        candidateTransport,
      );

      logMcpSessionEvent("info", "session_connected", {
        mcp_server_id: mcpServerId,
        selected_transport: candidateTransport,
        attempted_transports: attemptedTransports.join(","),
      });

      return {
        ...session,
        connection: {
          ...session.connection,
          attempted_transports: [...attemptedTransports],
          refreshed_before_connect: preConnectRefresh.refreshed,
        },
      };
    } catch (error) {
      if (!(error instanceof McpClientError)) {
        throw error;
      }

      lastConnectFailure = error;
      const hasFallbackCandidate = index < candidateTransports.length - 1;

      if (error.code === "AUTH_REQUIRED") {
        logMcpSessionEvent("warn", "session_auth_failed", {
          mcp_server_id: mcpServerId,
          selected_transport: candidateTransport,
          attempted_transports: attemptedTransports.join(","),
        });

        if (forcedAuthRetryUsed) {
          throw withSessionDiagnostics(error, [
            `attempted_transports=${attemptedTransports.join(",")}`,
            "auth_refresh_retry_used=true",
          ]);
        }

        forcedAuthRetryUsed = true;
        await refreshAndRetryOnAuthFailure(mcpServerId, candidateTransport);

        const refreshedConnection = resolveConnectionContext(mcpServerId);
        try {
          const retriedSession = await connectWithTransport(
            refreshedConnection.context,
            refreshedConnection.accessToken,
            candidateTransport,
          );

          logMcpSessionEvent("info", "session_connected_after_auth_retry", {
            mcp_server_id: mcpServerId,
            selected_transport: candidateTransport,
          });

          return {
            ...retriedSession,
            connection: {
              ...retriedSession.connection,
              attempted_transports: [...attemptedTransports],
              refreshed_before_connect: true,
            },
          };
        } catch (retryError) {
          if (!(retryError instanceof McpClientError)) {
            throw retryError;
          }

          lastConnectFailure = retryError;
          if (retryError.code === "AUTH_REQUIRED") {
            throw withSessionDiagnostics(retryError, [
              `attempted_transports=${attemptedTransports.join(",")}`,
              "auth_refresh_retry_used=true",
            ]);
          }

          if (!hasFallbackCandidate) {
            throw withSessionDiagnostics(retryError, [
              `attempted_transports=${attemptedTransports.join(",")}`,
              "auth_refresh_retry_used=true",
            ]);
          }

          continue;
        }
      }

      logMcpSessionEvent("warn", "session_connect_failed", {
        mcp_server_id: mcpServerId,
        selected_transport: candidateTransport,
        attempted_transports: attemptedTransports.join(","),
      });

      if (!hasFallbackCandidate) {
        throw withSessionDiagnostics(error, [`attempted_transports=${attemptedTransports.join(",")}`]);
      }
    }
  }

  if (lastConnectFailure) {
    throw withSessionDiagnostics(lastConnectFailure, [
      `attempted_transports=${attemptedTransports.join(",")}`,
    ]);
  }

  throw new McpClientError("MCP_CONNECT_FAILED", "Failed to connect to MCP server", {
    httpStatus: 502,
    details: [`attempted_transports=${attemptedTransports.join(",")}`],
  });
}
