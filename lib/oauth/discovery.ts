import "server-only";

import { canonicalizeMcpUrl } from "@/lib/servers";

const REQUEST_TIMEOUT_MS = 10_000;

export type OAuthDiscoveryErrorCode =
  | "DISCOVERY_FAILED"
  | "INVALID_METADATA"
  | "UNSUPPORTED_SERVER";

export class OAuthDiscoveryError extends Error {
  readonly code: OAuthDiscoveryErrorCode;
  readonly httpStatus: number;
  readonly details?: string[];

  constructor(
    code: OAuthDiscoveryErrorCode,
    message: string,
    options?: {
      httpStatus?: number;
      details?: string[];
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "OAuthDiscoveryError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 502;
    this.details = options?.details;
  }
}

export function isOAuthDiscoveryError(error: unknown): error is OAuthDiscoveryError {
  return error instanceof OAuthDiscoveryError;
}

export type ProtectedResourceMetadata = {
  authorization_servers: string[];
  [key: string]: unknown;
};

export type AuthorizationServerMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string | null;
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  [key: string]: unknown;
};

export type OAuthDiscoveryResult = {
  mcp_url: string;
  protected_resource_url: string;
  protected_resource_metadata: ProtectedResourceMetadata;
  authorization_server_url: string;
  authorization_server_metadata: AuthorizationServerMetadata;
};

type JsonObject = Record<string, unknown>;

function normalizeAbsoluteUrl(value: string, fieldName: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new OAuthDiscoveryError("INVALID_METADATA", `${fieldName} must be a valid absolute URL`, {
      httpStatus: 502,
    });
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    throw new OAuthDiscoveryError("INVALID_METADATA", `${fieldName} must use http or https`, {
      httpStatus: 502,
    });
  }

  return parsedUrl.toString();
}

function assertJsonObject(value: unknown, errorMessage: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OAuthDiscoveryError("INVALID_METADATA", errorMessage, { httpStatus: 502 });
  }

  return value as JsonObject;
}

function normalizeAuthorizationServers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OAuthDiscoveryError(
      "INVALID_METADATA",
      "Protected resource metadata is missing authorization_servers",
      { httpStatus: 502 },
    );
  }

  const parsedUrls = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizeAbsoluteUrl(entry, "authorization_servers[]"));

  if (parsedUrls.length === 0) {
    throw new OAuthDiscoveryError(
      "INVALID_METADATA",
      "Protected resource metadata has no usable authorization_servers",
      { httpStatus: 502 },
    );
  }

  return parsedUrls;
}

function buildAuthorizationServerWellKnownUrl(authorizationServerUrl: string) {
  const issuerUrl = new URL(authorizationServerUrl);
  const issuerPath = issuerUrl.pathname.replace(/\/+$/, "");

  if (!issuerPath || issuerPath === "/") {
    issuerUrl.pathname = "/.well-known/oauth-authorization-server";
  } else {
    issuerUrl.pathname = `/.well-known/oauth-authorization-server${issuerPath.startsWith("/") ? issuerPath : `/${issuerPath}`}`;
  }

  issuerUrl.search = "";
  issuerUrl.hash = "";

  return issuerUrl.toString();
}

async function fetchJsonObject(
  url: string,
  options: {
    endpointLabel: string;
    notFoundCode?: OAuthDiscoveryErrorCode;
    notFoundMessage: string;
  },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });

    if (response.status === 404 && options.notFoundCode) {
      throw new OAuthDiscoveryError(options.notFoundCode, options.notFoundMessage, {
        httpStatus: 400,
      });
    }

    if (!response.ok) {
      throw new OAuthDiscoveryError(
        "DISCOVERY_FAILED",
        `${options.endpointLabel} request failed with HTTP ${response.status}`,
        { httpStatus: 502 },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new OAuthDiscoveryError(
        "INVALID_METADATA",
        `${options.endpointLabel} did not return valid JSON`,
        { httpStatus: 502, cause: error },
      );
    }

    return assertJsonObject(payload, `${options.endpointLabel} must return a JSON object`);
  } catch (error) {
    if (isOAuthDiscoveryError(error)) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OAuthDiscoveryError(
        "DISCOVERY_FAILED",
        `${options.endpointLabel} request timed out`,
        { httpStatus: 504, cause: error },
      );
    }

    throw new OAuthDiscoveryError(
      "DISCOVERY_FAILED",
      `${options.endpointLabel} request failed`,
      { httpStatus: 502, cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAuthorizationServerMetadata(
  rawMetadata: JsonObject,
): AuthorizationServerMetadata {
  const authorizationEndpoint = rawMetadata.authorization_endpoint;
  const tokenEndpoint = rawMetadata.token_endpoint;

  if (typeof authorizationEndpoint !== "string" || authorizationEndpoint.trim().length === 0) {
    throw new OAuthDiscoveryError(
      "INVALID_METADATA",
      "Authorization server metadata is missing authorization_endpoint",
      { httpStatus: 502 },
    );
  }

  if (typeof tokenEndpoint !== "string" || tokenEndpoint.trim().length === 0) {
    throw new OAuthDiscoveryError(
      "INVALID_METADATA",
      "Authorization server metadata is missing token_endpoint",
      { httpStatus: 502 },
    );
  }

  const registrationEndpointValue = rawMetadata.registration_endpoint;
  const registrationEndpoint =
    typeof registrationEndpointValue === "string" && registrationEndpointValue.trim().length > 0
      ? normalizeAbsoluteUrl(registrationEndpointValue, "registration_endpoint")
      : null;

  const codeChallengeMethods = Array.isArray(rawMetadata.code_challenge_methods_supported)
    ? rawMetadata.code_challenge_methods_supported.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const tokenEndpointAuthMethods = Array.isArray(rawMetadata.token_endpoint_auth_methods_supported)
    ? rawMetadata.token_endpoint_auth_methods_supported.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];

  return {
    ...rawMetadata,
    authorization_endpoint: normalizeAbsoluteUrl(authorizationEndpoint, "authorization_endpoint"),
    token_endpoint: normalizeAbsoluteUrl(tokenEndpoint, "token_endpoint"),
    registration_endpoint: registrationEndpoint,
    code_challenge_methods_supported: codeChallengeMethods,
    token_endpoint_auth_methods_supported: tokenEndpointAuthMethods,
  };
}

export async function discoverProtectedResourceMetadata(mcpUrl: string) {
  let canonical: ReturnType<typeof canonicalizeMcpUrl>;
  try {
    canonical = canonicalizeMcpUrl(mcpUrl);
  } catch (error) {
    throw new OAuthDiscoveryError("INVALID_METADATA", "mcp_url is invalid for discovery", {
      httpStatus: 400,
      cause: error,
    });
  }

  const rawMetadata = await fetchJsonObject(canonical.protectedResourceDiscoveryUrl, {
    endpointLabel: "Protected resource metadata",
    notFoundCode: "UNSUPPORTED_SERVER",
    notFoundMessage: "This MCP server does not expose OAuth protected resource metadata",
  });

  const authorizationServers = normalizeAuthorizationServers(rawMetadata.authorization_servers);
  const metadata: ProtectedResourceMetadata = {
    ...rawMetadata,
    authorization_servers: authorizationServers,
  };

  return {
    mcp_url: canonical.canonicalUrl,
    protected_resource_url: canonical.protectedResourceDiscoveryUrl,
    metadata,
  };
}

export async function discoverAuthorizationServerMetadata(authorizationServerUrl: string) {
  const normalizedAuthorizationServerUrl = normalizeAbsoluteUrl(
    authorizationServerUrl,
    "authorization_server_url",
  );
  const metadataUrl = buildAuthorizationServerWellKnownUrl(normalizedAuthorizationServerUrl);

  const rawMetadata = await fetchJsonObject(metadataUrl, {
    endpointLabel: "Authorization server metadata",
    notFoundCode: "UNSUPPORTED_SERVER",
    notFoundMessage: "Authorization server metadata endpoint is unavailable",
  });

  return {
    authorization_server_url: normalizedAuthorizationServerUrl,
    authorization_server_metadata: normalizeAuthorizationServerMetadata(rawMetadata),
  };
}

export async function discoverOAuthMetadata(mcpUrl: string): Promise<OAuthDiscoveryResult> {
  const protectedResource = await discoverProtectedResourceMetadata(mcpUrl);
  const firstAuthorizationServer = protectedResource.metadata.authorization_servers[0];

  if (!firstAuthorizationServer) {
    throw new OAuthDiscoveryError(
      "INVALID_METADATA",
      "Protected resource metadata has no authorization server URL",
      { httpStatus: 502 },
    );
  }

  const authorizationServer = await discoverAuthorizationServerMetadata(firstAuthorizationServer);

  return {
    mcp_url: protectedResource.mcp_url,
    protected_resource_url: protectedResource.protected_resource_url,
    protected_resource_metadata: protectedResource.metadata,
    authorization_server_url: authorizationServer.authorization_server_url,
    authorization_server_metadata: authorizationServer.authorization_server_metadata,
  };
}
