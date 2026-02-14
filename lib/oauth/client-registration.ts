import "server-only";

import type { AuthorizationServerMetadata } from "@/lib/oauth/discovery";

const REQUEST_TIMEOUT_MS = 10_000;

export type OAuthClientCredentials = {
  clientId: string;
  clientSecret: string | null;
  strategy: "dynamic_registration" | "configured";
};

export class OAuthClientResolutionError extends Error {
  readonly code:
    | "REGISTRATION_FAILED"
    | "CLIENT_CONFIGURATION_REQUIRED"
    | "UNSUPPORTED_AUTH_METHOD";
  readonly httpStatus: number;

  constructor(
    code: OAuthClientResolutionError["code"],
    message: string,
    options?: { httpStatus?: number; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "OAuthClientResolutionError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 400;
  }
}

function normalizeServerEnvKey(serverId: string) {
  return serverId.trim().replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

function readFirstEnvValue(candidates: string[]) {
  for (const variableName of candidates) {
    const value = process.env[variableName];
    if (!value) {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

function resolveConfiguredClientCredentials(serverId: string): OAuthClientCredentials {
  const key = normalizeServerEnvKey(serverId);
  const clientId = readFirstEnvValue([
    `MCP_OAUTH_CLIENT_ID_${key}`,
    `OAUTH_CLIENT_ID_${key}`,
    `${key}_OAUTH_CLIENT_ID`,
    `${key}_CLIENT_ID`,
    "MCP_OAUTH_CLIENT_ID",
    "OAUTH_CLIENT_ID",
  ]);

  if (!clientId) {
    throw new OAuthClientResolutionError(
      "CLIENT_CONFIGURATION_REQUIRED",
      `Missing OAuth client configuration for server ${serverId}. Set OAUTH_CLIENT_ID_${key} (or MCP_OAUTH_CLIENT_ID_${key}).`,
      { httpStatus: 400 },
    );
  }

  const clientSecret = readFirstEnvValue([
    `MCP_OAUTH_CLIENT_SECRET_${key}`,
    `OAUTH_CLIENT_SECRET_${key}`,
    `${key}_OAUTH_CLIENT_SECRET`,
    `${key}_CLIENT_SECRET`,
    "MCP_OAUTH_CLIENT_SECRET",
    "OAUTH_CLIENT_SECRET",
  ]);

  return {
    clientId,
    clientSecret,
    strategy: "configured",
  };
}

function resolveRegistrationAuthMethod(metadata: AuthorizationServerMetadata) {
  const supportedMethods = metadata.token_endpoint_auth_methods_supported;
  if (!supportedMethods || supportedMethods.length === 0) {
    return "none";
  }

  if (supportedMethods.includes("none")) {
    return "none";
  }

  if (supportedMethods.includes("client_secret_post")) {
    return "client_secret_post";
  }

  throw new OAuthClientResolutionError(
    "UNSUPPORTED_AUTH_METHOD",
    "Authorization server does not support a compatible token endpoint auth method",
    { httpStatus: 400 },
  );
}

function assertJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OAuthClientResolutionError(
      "REGISTRATION_FAILED",
      "Client registration did not return a JSON object",
      { httpStatus: 502 },
    );
  }

  return value as Record<string, unknown>;
}

async function registerDynamicOAuthClient(
  metadata: AuthorizationServerMetadata,
  redirectUri: string,
) {
  const registrationEndpoint = metadata.registration_endpoint;
  if (!registrationEndpoint) {
    throw new OAuthClientResolutionError(
      "REGISTRATION_FAILED",
      "Registration endpoint is unavailable for dynamic client registration",
      { httpStatus: 400 },
    );
  }

  const tokenEndpointAuthMethod = resolveRegistrationAuthMethod(metadata);
  const payload = {
    client_name: "MCP Client Web",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: tokenEndpointAuthMethod,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(registrationEndpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new OAuthClientResolutionError(
        "REGISTRATION_FAILED",
        `Dynamic client registration failed with HTTP ${response.status}`,
        { httpStatus: 502 },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new OAuthClientResolutionError(
        "REGISTRATION_FAILED",
        "Dynamic client registration returned invalid JSON",
        { httpStatus: 502, cause: error },
      );
    }

    const registration = assertJsonObject(body);
    const clientId =
      typeof registration.client_id === "string" ? registration.client_id.trim() : "";

    if (!clientId) {
      throw new OAuthClientResolutionError(
        "REGISTRATION_FAILED",
        "Dynamic client registration response is missing client_id",
        { httpStatus: 502 },
      );
    }

    const clientSecret =
      typeof registration.client_secret === "string" && registration.client_secret.trim().length > 0
        ? registration.client_secret.trim()
        : null;

    return {
      clientId,
      clientSecret,
      strategy: "dynamic_registration" as const,
    };
  } catch (error) {
    if (error instanceof OAuthClientResolutionError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OAuthClientResolutionError(
        "REGISTRATION_FAILED",
        "Dynamic client registration request timed out",
        { httpStatus: 504, cause: error },
      );
    }

    throw new OAuthClientResolutionError(
      "REGISTRATION_FAILED",
      "Dynamic client registration request failed",
      { httpStatus: 502, cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveOAuthClientCredentials(
  serverId: string,
  metadata: AuthorizationServerMetadata,
  redirectUri: string,
) {
  if (!metadata.registration_endpoint) {
    return resolveConfiguredClientCredentials(serverId);
  }

  try {
    return await registerDynamicOAuthClient(metadata, redirectUri);
  } catch (error) {
    if (!(error instanceof OAuthClientResolutionError)) {
      throw error;
    }

    if (error.code !== "REGISTRATION_FAILED") {
      throw error;
    }

    return resolveConfiguredClientCredentials(serverId);
  }
}
