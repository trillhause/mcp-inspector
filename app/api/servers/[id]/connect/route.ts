import { NextResponse } from "next/server";

import {
  OAuthClientResolutionError,
  isOAuthAuthorizationFlowError,
  isOAuthDiscoveryError,
  startOAuthAuthorizationFlow,
} from "@/lib/oauth/authorize-flow";
import { bootstrapServerStore, PayloadValidationError } from "@/lib/servers";

export const runtime = "nodejs";

type ConnectRequestPayload = {
  redirect_uri?: unknown;
  scope?: unknown;
  prompt?: unknown;
};

type ValidatedConnectRequest = {
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

async function readOptionalJsonObject(request: Request): Promise<ConnectRequestPayload> {
  const rawBody = await request.text();
  if (rawBody.trim().length === 0) {
    return {};
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new PayloadValidationError(["Request body must be valid JSON"]);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PayloadValidationError(["Request body must be a JSON object"]);
  }

  return payload as ConnectRequestPayload;
}

function validateConnectPayload(payload: ConnectRequestPayload): ValidatedConnectRequest {
  const issues: string[] = [];
  let redirectUri: string | null = null;
  let scope: string | null = null;
  let prompt: string | null = null;

  if (payload.redirect_uri !== undefined) {
    if (typeof payload.redirect_uri !== "string" || payload.redirect_uri.trim().length === 0) {
      issues.push("redirect_uri must be a non-empty string when provided");
    } else {
      redirectUri = payload.redirect_uri.trim();
    }
  }

  if (payload.scope !== undefined) {
    if (typeof payload.scope !== "string" || payload.scope.trim().length === 0) {
      issues.push("scope must be a non-empty string when provided");
    } else {
      scope = payload.scope.trim();
    }
  }

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
    redirectUri,
    scope,
    prompt,
  };
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  bootstrapServerStore();
  const { id } = await context.params;

  let payload: ConnectRequestPayload;
  try {
    payload = await readOptionalJsonObject(request);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  let validatedPayload: ValidatedConnectRequest;
  try {
    validatedPayload = validateConnectPayload(payload);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    return errorResponse(400, "INVALID_REQUEST", "Request validation failed");
  }

  try {
    const authorization = await startOAuthAuthorizationFlow({
      request,
      mcpServerId: id,
      redirectUri: validatedPayload.redirectUri,
      scope: validatedPayload.scope,
      prompt: validatedPayload.prompt,
    });

    return NextResponse.json({
      mcp_server_id: authorization.mcp_server_id,
      next_action: "redirect",
      authorization_url: authorization.authorization_url,
      flow: authorization.flow,
    });
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return errorResponse(400, "INVALID_REQUEST", "Request validation failed", error.issues);
    }

    if (isOAuthAuthorizationFlowError(error)) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    if (isOAuthDiscoveryError(error)) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details);
    }

    if (error instanceof OAuthClientResolutionError) {
      return errorResponse(error.httpStatus, error.code, error.message);
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to initiate server connect flow");
  }
}
