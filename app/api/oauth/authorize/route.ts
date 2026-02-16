import { NextResponse } from "next/server";

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
import { bootstrapServerStore, PayloadValidationError } from "@/lib/servers";

export const runtime = "nodejs";

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

type AuthorizeRequestPayload = {
  mcp_server_id?: unknown;
  redirect_uri?: unknown;
  scope?: unknown;
  prompt?: unknown;
};

type ValidatedAuthorizeRequest = {
  mcpServerId: string;
  redirectUri: string | null;
  scope: string | null;
  prompt: string | null;
};

function errorResponse(status: number, code: string, message: string, details?: string[]) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details && details.length > 0 ? { details } : {}),
      },
    },
    { status },
  );
}

async function readJsonObject(request: Request): Promise<AuthorizeRequestPayload> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new PayloadValidationError(["Request body must be valid JSON"]);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PayloadValidationError(["Request body must be a JSON object"]);
  }

  return payload as AuthorizeRequestPayload;
}

function validateAuthorizePayload(payload: AuthorizeRequestPayload): ValidatedAuthorizeRequest {
  const issues: string[] = [];
  const mcpServerId =
    typeof payload.mcp_server_id === "string" ? payload.mcp_server_id.trim() : "";
  if (!mcpServerId) {
    issues.push("mcp_server_id is required");
  }

  let redirectUri: string | null = null;
  if (payload.redirect_uri !== undefined) {
    if (typeof payload.redirect_uri !== "string" || payload.redirect_uri.trim().length === 0) {
      issues.push("redirect_uri must be a non-empty string when provided");
    } else {
      redirectUri = payload.redirect_uri.trim();
    }
  }

  let scope: string | null = null;
  if (payload.scope !== undefined) {
    if (typeof payload.scope !== "string" || payload.scope.trim().length === 0) {
      issues.push("scope must be a non-empty string when provided");
    } else {
      scope = payload.scope.trim();
    }
  }

  let prompt: string | null = null;
  if (payload.prompt !== undefined) {
    if (typeof payload.prompt !== "string" || payload.prompt.trim().length === 0) {
      issues.push("prompt must be a non-empty string when provided");
    } else {
      prompt = payload.prompt.trim();
    }
  }

  if (issues.length > 0) {
    throw new PayloadValidationError(issues);
  }

  return {
    mcpServerId,
    redirectUri,
    scope,
    prompt,
  };
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

export async function POST(request: Request) {
  bootstrapServerStore();

  let payload: AuthorizeRequestPayload;
  try {
    payload = await readJsonObject(request);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  let validatedPayload: ValidatedAuthorizeRequest;
  try {
    validatedPayload = validateAuthorizePayload(payload);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  const server = readServerById(validatedPayload.mcpServerId);
  if (!server) {
    return errorResponse(404, "NOT_FOUND", "Server not found");
  }

  let redirectUri: string;
  try {
    redirectUri = resolveRedirectUri(request, validatedPayload.redirectUri);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  try {
    const discovery = await discoverOAuthMetadata(server.mcp_url);
    const pkceMethods = discovery.authorization_server_metadata.code_challenge_methods_supported;

    if (pkceMethods.length > 0 && !pkceMethods.includes("S256")) {
      return errorResponse(
        400,
        "UNSUPPORTED_SERVER",
        "Authorization server does not support PKCE S256",
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
        scope: validatedPayload.scope,
        prompt: validatedPayload.prompt,
      },
    );

    return NextResponse.json({
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
    });
  } catch (error) {
    if (isOAuthDiscoveryError(error)) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    if (error instanceof OAuthClientResolutionError) {
      return errorResponse(error.httpStatus, error.code, error.message);
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to initiate OAuth authorization");
  }
}
