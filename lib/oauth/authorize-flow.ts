import "server-only";

import { dbQueryFirst } from "@/lib/db";
import {
  OAuthClientResolutionError,
  resolveOAuthClientCredentials,
} from "@/lib/oauth/client-registration";
import {
  discoverOAuthMetadata,
  isOAuthDiscoveryError,
} from "@/lib/oauth/discovery";
import {
  generateCodeChallengeS256,
  generateCodeVerifier,
  generateState,
} from "@/lib/oauth/pkce";
import { createOAuthState } from "@/lib/oauth/state";
import { PayloadValidationError } from "@/lib/servers";

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

type StartOAuthAuthorizationFlowInput = {
  request: Request;
  mcpServerId: string;
  redirectUri?: string | null;
  scope?: string | null;
  prompt?: string | null;
};

export type StartOAuthAuthorizationFlowResult = {
  mcp_server_id: string;
  authorization_url: string;
  flow: {
    mcp_server_id: string;
    expires_at: string;
    redirect_uri: string;
    authorization_server_url: string;
    protected_resource_url: string;
    client_strategy: "configured" | "dynamic_registration";
    code_challenge_method: "S256";
  };
};

export class OAuthAuthorizationFlowError extends Error {
  readonly code: "NOT_FOUND" | "UNSUPPORTED_SERVER";
  readonly httpStatus: number;
  readonly details?: string[];

  constructor(
    code: OAuthAuthorizationFlowError["code"],
    message: string,
    options?: {
      httpStatus?: number;
      details?: string[];
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "OAuthAuthorizationFlowError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 400;
    this.details = options?.details;
  }
}

export function isOAuthAuthorizationFlowError(
  error: unknown,
): error is OAuthAuthorizationFlowError {
  return error instanceof OAuthAuthorizationFlowError;
}

function resolveRequestOrigin(request: Request) {
  return new URL(request.url).origin;
}

function isAllowedHttpHostname(hostname: string) {
  if (LOCALHOST_HOSTNAMES.has(hostname)) {
    return true;
  }

  return hostname.endsWith(".localhost");
}

function resolveRedirectUri(request: Request, userProvidedRedirectUri: string | null) {
  const requestOrigin = resolveRequestOrigin(request);
  const rawRedirectUri = userProvidedRedirectUri ?? `${requestOrigin}/api/oauth/callback`;
  const parsedRedirectUri = rawRedirectUri.startsWith("/")
    ? new URL(rawRedirectUri, requestOrigin)
    : new URL(rawRedirectUri);
  const protocol = parsedRedirectUri.protocol.toLowerCase();
  const hostname = parsedRedirectUri.hostname.toLowerCase();

  if (protocol !== "https:" && (protocol !== "http:" || !isAllowedHttpHostname(hostname))) {
    throw new PayloadValidationError([
      "redirect_uri must use https:// (or http:// for localhost)",
    ]);
  }

  return parsedRedirectUri.toString();
}

function readServerById(serverId: string) {
  return dbQueryFirst<{ id: string; mcp_url: string }>(
    "SELECT id, mcp_url FROM mcp_servers WHERE id = ? LIMIT 1",
    [serverId],
  );
}

function buildAuthorizationUrl(
  authorizationEndpoint: string,
  params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scope: string | null;
    prompt: string | null;
  },
) {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (params.scope) {
    url.searchParams.set("scope", params.scope);
  }

  if (params.prompt) {
    url.searchParams.set("prompt", params.prompt);
  }

  return url.toString();
}

export async function startOAuthAuthorizationFlow(
  input: StartOAuthAuthorizationFlowInput,
): Promise<StartOAuthAuthorizationFlowResult> {
  const server = readServerById(input.mcpServerId);
  if (!server) {
    throw new OAuthAuthorizationFlowError("NOT_FOUND", "Server not found", {
      httpStatus: 404,
    });
  }

  const redirectUri = resolveRedirectUri(input.request, input.redirectUri ?? null);
  const discovery = await discoverOAuthMetadata(server.mcp_url);
  const pkceMethods = discovery.authorization_server_metadata.code_challenge_methods_supported;

  if (pkceMethods.length > 0 && !pkceMethods.includes("S256")) {
    throw new OAuthAuthorizationFlowError(
      "UNSUPPORTED_SERVER",
      "Authorization server does not support PKCE S256",
      {
        httpStatus: 400,
      },
    );
  }

  const clientCredentials = await resolveOAuthClientCredentials(
    server.id,
    discovery.authorization_server_metadata,
    redirectUri,
  );
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallengeS256(codeVerifier);
  const state = generateState();
  const storedState = createOAuthState({
    mcpServerId: server.id,
    stateValue: state,
    codeVerifier,
    clientId: clientCredentials.clientId,
    clientSecret: clientCredentials.clientSecret,
    oauthMetadata: discovery.authorization_server_metadata,
    protectedResourceUrl: discovery.protected_resource_url,
    authorizationServerUrl: discovery.authorization_server_url,
    redirectUri,
  });

  const authorizationUrl = buildAuthorizationUrl(
    discovery.authorization_server_metadata.authorization_endpoint,
    {
      clientId: clientCredentials.clientId,
      redirectUri,
      state,
      codeChallenge,
      scope: input.scope ?? null,
      prompt: input.prompt ?? null,
    },
  );

  return {
    mcp_server_id: server.id,
    authorization_url: authorizationUrl,
    flow: {
      mcp_server_id: server.id,
      expires_at: storedState.expires_at,
      redirect_uri: redirectUri,
      authorization_server_url: discovery.authorization_server_url,
      protected_resource_url: discovery.protected_resource_url,
      client_strategy: clientCredentials.strategy,
      code_challenge_method: "S256",
    },
  };
}

export {
  OAuthClientResolutionError,
  isOAuthDiscoveryError,
};
