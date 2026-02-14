import { NextResponse } from "next/server";

import { dbQueryFirst } from "@/lib/db";
import { enqueueCapabilitiesRefresh } from "@/lib/mcp/capabilities-refresh";
import { upsertOAuthCredentials } from "@/lib/oauth/credentials";
import {
  consumeOAuthState,
  type PersistedOAuthState,
} from "@/lib/oauth/state";
import {
  exchangeAuthorizationCodeForTokens,
  OAuthTokenExchangeError,
} from "@/lib/oauth/token-exchange";
import { bootstrapServerStore, PayloadValidationError } from "@/lib/servers";

export const runtime = "nodejs";

type CallbackRequestPayload = {
  code?: unknown;
  state?: unknown;
  error?: unknown;
  error_description?: unknown;
  error_uri?: unknown;
};

type CallbackInput = {
  code: string | null;
  state: string | null;
  providerError: {
    error: string;
    description: string | null;
    uri: string | null;
  } | null;
};

type CallbackFailure = {
  status: number;
  code: string;
  message: string;
  details?: string[];
  mcpServerId?: string | null;
};

function errorResponse(failure: CallbackFailure, redirectTo?: string) {
  return NextResponse.json(
    {
      error: {
        code: failure.code,
        message: failure.message,
        ...(failure.details && failure.details.length > 0 ? { details: failure.details } : {}),
      },
      ...(redirectTo ? { redirect_to: redirectTo } : {}),
      ...(failure.mcpServerId ? { mcp_server_id: failure.mcpServerId } : {}),
    },
    { status: failure.status },
  );
}

async function readJsonObject(request: Request): Promise<CallbackRequestPayload> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new PayloadValidationError(["Request body must be valid JSON"]);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PayloadValidationError(["Request body must be a JSON object"]);
  }

  return payload as CallbackRequestPayload;
}

function parseCallbackInput(payload: CallbackRequestPayload): CallbackInput {
  const code =
    typeof payload.code === "string" && payload.code.trim().length > 0
      ? payload.code.trim()
      : null;
  const state =
    typeof payload.state === "string" && payload.state.trim().length > 0
      ? payload.state.trim()
      : null;

  const providerError =
    typeof payload.error === "string" && payload.error.trim().length > 0
      ? {
          error: payload.error.trim(),
          description:
            typeof payload.error_description === "string" &&
            payload.error_description.trim().length > 0
              ? payload.error_description.trim()
              : null,
          uri:
            typeof payload.error_uri === "string" && payload.error_uri.trim().length > 0
              ? payload.error_uri.trim()
              : null,
        }
      : null;

  return {
    code,
    state,
    providerError,
  };
}

function parseCallbackInputFromUrl(request: Request) {
  const requestUrl = new URL(request.url);
  return parseCallbackInput({
    code: requestUrl.searchParams.get("code"),
    state: requestUrl.searchParams.get("state"),
    error: requestUrl.searchParams.get("error"),
    error_description: requestUrl.searchParams.get("error_description"),
    error_uri: requestUrl.searchParams.get("error_uri"),
  });
}

function parseStateMetadata(storedState: PersistedOAuthState) {
  if (!storedState.oauth_metadata) {
    return {
      tokenEndpoint: null,
      oauthMetadata: null as Record<string, unknown> | null,
    };
  }

  let parsedMetadata: unknown;
  try {
    parsedMetadata = JSON.parse(storedState.oauth_metadata);
  } catch {
    return {
      tokenEndpoint: null,
      oauthMetadata: null as Record<string, unknown> | null,
    };
  }

  if (!parsedMetadata || typeof parsedMetadata !== "object" || Array.isArray(parsedMetadata)) {
    return {
      tokenEndpoint: null,
      oauthMetadata: null as Record<string, unknown> | null,
    };
  }

  const oauthMetadata = parsedMetadata as Record<string, unknown>;
  const tokenEndpoint =
    typeof oauthMetadata.token_endpoint === "string" && oauthMetadata.token_endpoint.trim().length > 0
      ? oauthMetadata.token_endpoint.trim()
      : null;

  return {
    tokenEndpoint,
    oauthMetadata,
  };
}

function buildUiRedirectUrl(
  request: Request,
  params: {
    status: "success" | "error";
    mcpServerId?: string | null;
    errorCode?: string;
    errorMessage?: string;
  },
) {
  const requestUrl = new URL(request.url);
  const redirectUrl = new URL("/", requestUrl.origin);

  redirectUrl.searchParams.set("oauth_status", params.status);
  if (params.mcpServerId) {
    redirectUrl.searchParams.set("mcp_server_id", params.mcpServerId);
  }
  if (params.errorCode) {
    redirectUrl.searchParams.set("oauth_error_code", params.errorCode);
  }
  if (params.errorMessage) {
    redirectUrl.searchParams.set("oauth_error_message", params.errorMessage);
  }

  return redirectUrl.toString();
}

type CallbackProcessResult =
  | {
      ok: true;
      payload: {
        mcp_server_id: string;
        connected_at: string;
        token_expires_at: string | null;
      };
    }
  | { ok: false; failure: CallbackFailure };

function validateInput(input: CallbackInput): CallbackFailure | null {
  if (input.providerError) {
    if (!input.state) {
      return {
        status: 400,
        code: "INVALID_REQUEST",
        message: "OAuth callback is missing required state",
      };
    }

    return null;
  }

  const issues: string[] = [];
  if (!input.code) {
    issues.push("code is required");
  }

  if (!input.state) {
    issues.push("state is required");
  }

  if (issues.length > 0) {
    return {
      status: 400,
      code: "INVALID_REQUEST",
      message: "OAuth callback validation failed",
      details: issues,
    };
  }

  return null;
}

async function processCallback(input: CallbackInput): Promise<CallbackProcessResult> {
  const inputValidationFailure = validateInput(input);
  if (inputValidationFailure) {
    return {
      ok: false,
      failure: inputValidationFailure,
    };
  }

  const stateValue = input.state as string;
  const consumed = consumeOAuthState(stateValue);
  if (consumed.status !== "consumed") {
    if (consumed.status === "expired") {
      return {
        ok: false,
        failure: {
          status: 400,
          code: "STATE_EXPIRED",
          message: "OAuth state has expired. Start a new connect flow.",
        },
      };
    }

    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_STATE",
        message: "OAuth state is invalid or has already been used",
      },
    };
  }

  const storedState = consumed.state;

  if (input.providerError) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "OAUTH_PROVIDER_ERROR",
        message: input.providerError.description ?? "OAuth provider returned an error",
        mcpServerId: storedState.mcp_server_id,
        details: [
          `provider_error=${input.providerError.error}`,
          input.providerError.description,
          input.providerError.uri,
        ].filter((value): value is string => !!value),
      },
    };
  }

  const metadata = parseStateMetadata(storedState);
  if (!metadata.oauthMetadata || !metadata.tokenEndpoint) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_STATE",
        message: "OAuth state is missing token endpoint metadata. Start a new connect flow.",
        mcpServerId: storedState.mcp_server_id,
      },
    };
  }

  if (!storedState.client_id || storedState.client_id.trim().length === 0) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_STATE",
        message: "OAuth state is missing client_id. Start a new connect flow.",
        mcpServerId: storedState.mcp_server_id,
      },
    };
  }

  const server = dbQueryFirst<{ id: string }>("SELECT id FROM mcp_servers WHERE id = ? LIMIT 1", [
    storedState.mcp_server_id,
  ]);
  if (!server) {
    return {
      ok: false,
      failure: {
        status: 404,
        code: "NOT_FOUND",
        message: "Server not found for OAuth callback",
      },
    };
  }

  try {
    const exchanged = await exchangeAuthorizationCodeForTokens({
      tokenEndpoint: metadata.tokenEndpoint,
      code: input.code as string,
      redirectUri: storedState.redirect_uri,
      clientId: storedState.client_id,
      codeVerifier: storedState.code_verifier,
      clientSecret: storedState.client_secret,
    });

    const writeResult = upsertOAuthCredentials({
      mcpServerId: storedState.mcp_server_id,
      clientId: storedState.client_id,
      clientSecret: storedState.client_secret,
      accessToken: exchanged.access_token,
      refreshToken: exchanged.refresh_token,
      expiresIn: exchanged.expires_in,
      scope: exchanged.scope,
      oauthMetadata: metadata.oauthMetadata,
      protectedResourceUrl: storedState.protected_resource_url,
      authorizationServerUrl: storedState.authorization_server_url,
    });

    // Fire-and-forget so OAuth callback UX is not blocked by MCP discovery latency.
    enqueueCapabilitiesRefresh({
      mcpServerId: storedState.mcp_server_id,
      reason: "oauth_callback",
    });

    return {
      ok: true,
      payload: {
        mcp_server_id: storedState.mcp_server_id,
        connected_at: writeResult.connectedAt,
        token_expires_at: writeResult.tokenExpiresAt,
      },
    };
  } catch (error) {
    if (error instanceof OAuthTokenExchangeError) {
      return {
        ok: false,
        failure: {
          status: error.httpStatus,
          code: error.code,
          message: error.message,
          details: error.details,
          mcpServerId: storedState.mcp_server_id,
        },
      };
    }

    return {
      ok: false,
      failure: {
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to complete OAuth callback",
        mcpServerId: storedState.mcp_server_id,
      },
    };
  }
}

async function handlePostCallback(request: Request, input: CallbackInput) {
  const result = await processCallback(input);
  if (!result.ok) {
    const redirectTo = buildUiRedirectUrl(request, {
      status: "error",
      mcpServerId: result.failure.mcpServerId,
      errorCode: result.failure.code,
      errorMessage: result.failure.message,
    });

    return errorResponse(result.failure, redirectTo);
  }

  const redirectTo = buildUiRedirectUrl(request, {
    status: "success",
    mcpServerId: result.payload.mcp_server_id,
  });

  return NextResponse.json({
    ...result.payload,
    redirect_to: redirectTo,
  });
}

export async function POST(request: Request) {
  bootstrapServerStore();

  let payload: CallbackRequestPayload;
  try {
    payload = await readJsonObject(request);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse({
        status: 400,
        code: "INVALID_REQUEST",
        message: "Request validation failed",
        details: error.issues,
      });
    }

    return errorResponse({
      status: 400,
      code: "INVALID_REQUEST",
      message: "Request validation failed",
    });
  }

  const input = parseCallbackInput(payload);
  return handlePostCallback(request, input);
}

export async function GET(request: Request) {
  bootstrapServerStore();

  const input = parseCallbackInputFromUrl(request);
  const result = await processCallback(input);

  if (!result.ok) {
    const redirectTo = buildUiRedirectUrl(request, {
      status: "error",
      mcpServerId: result.failure.mcpServerId,
      errorCode: result.failure.code,
      errorMessage: result.failure.message,
    });
    return NextResponse.redirect(redirectTo, { status: 302 });
  }

  const redirectTo = buildUiRedirectUrl(request, {
    status: "success",
    mcpServerId: result.payload.mcp_server_id,
  });
  return NextResponse.redirect(redirectTo, { status: 302 });
}
