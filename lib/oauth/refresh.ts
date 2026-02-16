import "server-only";

import { dbExecute, dbQueryFirst } from "@/lib/db";

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const inflightRefreshByServer = new Map<string, Promise<RefreshOAuthCredentialResult>>();

type StoredCredentialRow = {
  mcp_server_id: string;
  client_id: string;
  client_secret: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  oauth_metadata: string;
  connected_at: string;
  last_refreshed_at: string | null;
};

type RefreshGrantInput = {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
};

type RefreshGrantResult = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
  scope: string | null;
  raw: Record<string, unknown>;
};

export type RefreshReason =
  | "not_needed"
  | "forced"
  | "expired"
  | "expiring_soon"
  | "missing_refresh_token"
  | "missing_token_endpoint"
  | "invalid_grant";

export type RefreshStatus = "connected" | "reconnect_required";

export type RefreshOAuthCredentialInput = {
  mcpServerId: string;
  force?: boolean;
  now?: Date;
  refreshBufferMs?: number;
};

export type RefreshOAuthCredentialResult = {
  mcp_server_id: string;
  status: RefreshStatus;
  refreshed: boolean;
  refresh_reason: RefreshReason;
  connected_at: string;
  token_expires_at: string | null;
  last_refreshed_at: string | null;
};

class OAuthTokenRefreshError extends Error {
  readonly code: "REFRESH_FAILED" | "INVALID_TOKEN_RESPONSE" | "INVALID_GRANT";
  readonly httpStatus: number;
  readonly details?: string[];

  constructor(
    code: OAuthTokenRefreshError["code"],
    message: string,
    options?: { httpStatus?: number; details?: string[]; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "OAuthTokenRefreshError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 502;
    this.details = options?.details;
  }
}

export class OAuthRefreshError extends Error {
  readonly code: "NOT_CONNECTED" | "REFRESH_FAILED";
  readonly httpStatus: number;
  readonly details?: string[];

  constructor(
    code: OAuthRefreshError["code"],
    message: string,
    options?: { httpStatus?: number; details?: string[]; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "OAuthRefreshError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 500;
    this.details = options?.details;
  }
}

function logRefreshEvent(
  level: "info" | "warn" | "error",
  event: string,
  context: Record<string, unknown>,
) {
  const message = `[oauth-refresh] ${event}`;

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

function resolveTokenExpiresAt(expiresInSeconds: number | null, now: Date) {
  if (!expiresInSeconds || expiresInSeconds <= 0) {
    return null;
  }

  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

export function isAccessTokenExpired(tokenExpiresAt: string | null, now = new Date()) {
  if (!tokenExpiresAt) {
    return false;
  }

  const parsed = Date.parse(tokenExpiresAt);
  if (Number.isNaN(parsed)) {
    return true;
  }

  return parsed <= now.getTime();
}

export function shouldRefreshAccessToken(
  tokenExpiresAt: string | null,
  now = new Date(),
  refreshBufferMs = DEFAULT_REFRESH_BUFFER_MS,
) {
  if (!tokenExpiresAt) {
    return false;
  }

  const parsed = Date.parse(tokenExpiresAt);
  if (Number.isNaN(parsed)) {
    return true;
  }

  return parsed - now.getTime() <= refreshBufferMs;
}

function readCredentialByServerId(mcpServerId: string) {
  return dbQueryFirst<StoredCredentialRow>(
    `SELECT
      mcp_server_id,
      client_id,
      client_secret,
      access_token,
      refresh_token,
      token_expires_at,
      scopes,
      oauth_metadata,
      connected_at,
      last_refreshed_at
    FROM oauth_credentials
    WHERE mcp_server_id = ?
    LIMIT 1`,
    [mcpServerId],
  );
}

function parseTokenEndpoint(oauthMetadataJson: string) {
  try {
    const parsed = JSON.parse(oauthMetadataJson) as Record<string, unknown>;
    const tokenEndpoint = parsed.token_endpoint;
    if (typeof tokenEndpoint !== "string" || tokenEndpoint.trim().length === 0) {
      return null;
    }

    return tokenEndpoint.trim();
  } catch {
    return null;
  }
}

function normalizeRefreshToken(token: string | null) {
  if (!token) {
    return null;
  }

  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readProviderError(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const jsonBody = body as Record<string, unknown>;
  const tokenError = typeof jsonBody.error === "string" ? jsonBody.error : null;
  const tokenErrorDescription =
    typeof jsonBody.error_description === "string" ? jsonBody.error_description : null;

  if (!tokenError && !tokenErrorDescription) {
    return null;
  }

  return {
    error: tokenError,
    description: tokenErrorDescription,
  };
}

function parseExpiresIn(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  throw new OAuthTokenRefreshError(
    "INVALID_TOKEN_RESPONSE",
    "Refresh response contains an invalid expires_in value",
    { httpStatus: 502 },
  );
}

function normalizeRefreshGrantResponse(payload: unknown): RefreshGrantResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OAuthTokenRefreshError(
      "INVALID_TOKEN_RESPONSE",
      "Refresh token endpoint did not return a JSON object",
      { httpStatus: 502 },
    );
  }

  const body = payload as Record<string, unknown>;
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!accessToken) {
    throw new OAuthTokenRefreshError(
      "INVALID_TOKEN_RESPONSE",
      "Refresh response is missing access_token",
      { httpStatus: 502 },
    );
  }

  const refreshToken =
    typeof body.refresh_token === "string" && body.refresh_token.trim().length > 0
      ? body.refresh_token.trim()
      : null;
  const scope = typeof body.scope === "string" && body.scope.trim().length > 0 ? body.scope : null;
  const expiresIn = parseExpiresIn(body.expires_in);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    scope,
    raw: body,
  };
}

async function requestRefreshGrant(input: RefreshGrantInput): Promise<RefreshGrantResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });

  if (input.clientSecret) {
    body.set("client_secret", input.clientSecret);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(input.tokenEndpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      signal: controller.signal,
    });

    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      const providerError = readProviderError(parsedBody);
      const details = providerError
        ? [providerError.error, providerError.description].filter((value): value is string => !!value)
        : undefined;

      if (providerError?.error === "invalid_grant") {
        throw new OAuthTokenRefreshError(
          "INVALID_GRANT",
          providerError.description ?? "Refresh token is invalid",
          {
            httpStatus: 400,
            details,
          },
        );
      }

      throw new OAuthTokenRefreshError(
        "REFRESH_FAILED",
        providerError?.description ??
          providerError?.error ??
          `Refresh token endpoint request failed with HTTP ${response.status}`,
        {
          httpStatus: response.status === 400 ? 400 : 502,
          details,
        },
      );
    }

    return normalizeRefreshGrantResponse(parsedBody);
  } catch (error) {
    if (error instanceof OAuthTokenRefreshError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OAuthTokenRefreshError("REFRESH_FAILED", "Refresh request timed out", {
        httpStatus: 504,
        cause: error,
      });
    }

    throw new OAuthTokenRefreshError("REFRESH_FAILED", "Refresh request failed", {
      httpStatus: 502,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function markCredentialReconnectRequired(
  mcpServerId: string,
  nowIso: string,
  clearRefreshToken: boolean,
) {
  if (clearRefreshToken) {
    dbExecute(
      `UPDATE oauth_credentials
       SET token_expires_at = @token_expires_at,
           refresh_token = NULL,
           last_refreshed_at = @last_refreshed_at
       WHERE mcp_server_id = @mcp_server_id`,
      {
        token_expires_at: nowIso,
        last_refreshed_at: nowIso,
        mcp_server_id: mcpServerId,
      },
    );
    return;
  }

  dbExecute(
    `UPDATE oauth_credentials
     SET token_expires_at = @token_expires_at,
         last_refreshed_at = @last_refreshed_at
     WHERE mcp_server_id = @mcp_server_id`,
    {
      token_expires_at: nowIso,
      last_refreshed_at: nowIso,
      mcp_server_id: mcpServerId,
    },
  );
}

function determineRefreshReason(
  credential: StoredCredentialRow,
  now: Date,
  force: boolean,
): "forced" | "expired" | "expiring_soon" {
  if (force) {
    return "forced";
  }

  if (isAccessTokenExpired(credential.token_expires_at, now)) {
    return "expired";
  }

  return "expiring_soon";
}

async function refreshOAuthCredentialInternal(
  input: RefreshOAuthCredentialInput,
): Promise<RefreshOAuthCredentialResult> {
  const credential = readCredentialByServerId(input.mcpServerId);
  if (!credential) {
    throw new OAuthRefreshError("NOT_CONNECTED", "No OAuth credentials found for this server", {
      httpStatus: 404,
    });
  }

  const now = input.now ?? new Date();
  const force = input.force === true;
  const refreshBufferMs =
    typeof input.refreshBufferMs === "number" && Number.isFinite(input.refreshBufferMs)
      ? Math.max(0, input.refreshBufferMs)
      : DEFAULT_REFRESH_BUFFER_MS;
  const shouldRefresh = force || shouldRefreshAccessToken(credential.token_expires_at, now, refreshBufferMs);

  if (!shouldRefresh) {
    return {
      mcp_server_id: credential.mcp_server_id,
      status: "connected",
      refreshed: false,
      refresh_reason: "not_needed",
      connected_at: credential.connected_at,
      token_expires_at: credential.token_expires_at,
      last_refreshed_at: credential.last_refreshed_at,
    };
  }

  const refreshToken = normalizeRefreshToken(credential.refresh_token);
  if (!refreshToken) {
    const nowIso = now.toISOString();
    markCredentialReconnectRequired(credential.mcp_server_id, nowIso, false);
    logRefreshEvent("warn", "refresh_unrecoverable_missing_refresh_token", {
      mcp_server_id: credential.mcp_server_id,
    });

    return {
      mcp_server_id: credential.mcp_server_id,
      status: "reconnect_required",
      refreshed: false,
      refresh_reason: "missing_refresh_token",
      connected_at: credential.connected_at,
      token_expires_at: nowIso,
      last_refreshed_at: nowIso,
    };
  }

  const tokenEndpoint = parseTokenEndpoint(credential.oauth_metadata);
  if (!tokenEndpoint) {
    const nowIso = now.toISOString();
    markCredentialReconnectRequired(credential.mcp_server_id, nowIso, false);
    logRefreshEvent("warn", "refresh_unrecoverable_missing_token_endpoint", {
      mcp_server_id: credential.mcp_server_id,
    });

    return {
      mcp_server_id: credential.mcp_server_id,
      status: "reconnect_required",
      refreshed: false,
      refresh_reason: "missing_token_endpoint",
      connected_at: credential.connected_at,
      token_expires_at: nowIso,
      last_refreshed_at: nowIso,
    };
  }

  const refreshReason = determineRefreshReason(credential, now, force);

  try {
    const refreshed = await requestRefreshGrant({
      tokenEndpoint,
      clientId: credential.client_id,
      clientSecret: credential.client_secret,
      refreshToken,
    });

    const refreshedAt = now.toISOString();
    const nextRefreshToken = refreshed.refresh_token ?? refreshToken;
    const nextTokenExpiresAt = resolveTokenExpiresAt(refreshed.expires_in, now);
    const nextScope = refreshed.scope ?? credential.scopes;

    dbExecute(
      `UPDATE oauth_credentials
       SET access_token = @access_token,
           refresh_token = @refresh_token,
           token_expires_at = @token_expires_at,
           scopes = @scopes,
           last_refreshed_at = @last_refreshed_at
       WHERE mcp_server_id = @mcp_server_id`,
      {
        access_token: refreshed.access_token,
        refresh_token: nextRefreshToken,
        token_expires_at: nextTokenExpiresAt,
        scopes: nextScope,
        last_refreshed_at: refreshedAt,
        mcp_server_id: credential.mcp_server_id,
      },
    );

    logRefreshEvent("info", "refresh_succeeded", {
      mcp_server_id: credential.mcp_server_id,
      reason: refreshReason,
      refresh_token_rotated: refreshed.refresh_token !== null,
      has_access_token_expiry: nextTokenExpiresAt !== null,
      response_has_scope: refreshed.scope !== null,
      raw_claim_count: Object.keys(refreshed.raw).length,
    });

    return {
      mcp_server_id: credential.mcp_server_id,
      status: "connected",
      refreshed: true,
      refresh_reason: refreshReason,
      connected_at: credential.connected_at,
      token_expires_at: nextTokenExpiresAt,
      last_refreshed_at: refreshedAt,
    };
  } catch (error) {
    if (error instanceof OAuthTokenRefreshError && error.code === "INVALID_GRANT") {
      const nowIso = now.toISOString();
      markCredentialReconnectRequired(credential.mcp_server_id, nowIso, true);
      logRefreshEvent("warn", "refresh_invalid_grant_reconnect_required", {
        mcp_server_id: credential.mcp_server_id,
        reason: refreshReason,
        details: error.details,
      });

      return {
        mcp_server_id: credential.mcp_server_id,
        status: "reconnect_required",
        refreshed: false,
        refresh_reason: "invalid_grant",
        connected_at: credential.connected_at,
        token_expires_at: nowIso,
        last_refreshed_at: nowIso,
      };
    }

    if (error instanceof OAuthTokenRefreshError) {
      logRefreshEvent("error", "refresh_failed", {
        mcp_server_id: credential.mcp_server_id,
        reason: refreshReason,
        status: error.httpStatus,
        details: error.details,
      });
      throw new OAuthRefreshError("REFRESH_FAILED", error.message, {
        httpStatus: error.httpStatus,
        details: error.details,
        cause: error,
      });
    }

    logRefreshEvent("error", "refresh_failed_unexpected", {
      mcp_server_id: credential.mcp_server_id,
      reason: refreshReason,
    });
    throw new OAuthRefreshError("REFRESH_FAILED", "Token refresh failed", {
      httpStatus: 500,
      cause: error,
    });
  }
}

export async function refreshOAuthCredential(
  input: RefreshOAuthCredentialInput,
): Promise<RefreshOAuthCredentialResult> {
  const existing = inflightRefreshByServer.get(input.mcpServerId);
  if (existing) {
    logRefreshEvent("info", "refresh_single_flight_reused", {
      mcp_server_id: input.mcpServerId,
    });
    return existing;
  }

  const promise = refreshOAuthCredentialInternal(input).finally(() => {
    if (inflightRefreshByServer.get(input.mcpServerId) === promise) {
      inflightRefreshByServer.delete(input.mcpServerId);
    }
  });

  inflightRefreshByServer.set(input.mcpServerId, promise);
  return promise;
}
