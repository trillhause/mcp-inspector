import "server-only";

const REQUEST_TIMEOUT_MS = 10_000;

export class OAuthTokenExchangeError extends Error {
  readonly code: "TOKEN_EXCHANGE_FAILED" | "INVALID_TOKEN_RESPONSE";
  readonly httpStatus: number;
  readonly details?: string[];

  constructor(
    code: OAuthTokenExchangeError["code"],
    message: string,
    options?: { httpStatus?: number; details?: string[]; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "OAuthTokenExchangeError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 502;
    this.details = options?.details;
  }
}

type TokenExchangeInput = {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
  clientSecret: string | null;
};

export type TokenExchangeResult = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
  scope: string | null;
  raw: Record<string, unknown>;
};

function assertJsonObject(value: unknown, errorMessage: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OAuthTokenExchangeError("INVALID_TOKEN_RESPONSE", errorMessage, { httpStatus: 502 });
  }

  return value as Record<string, unknown>;
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

  throw new OAuthTokenExchangeError(
    "INVALID_TOKEN_RESPONSE",
    "Token response contains an invalid expires_in value",
    { httpStatus: 502 },
  );
}

function normalizeTokenResponse(payload: unknown): TokenExchangeResult {
  const body = assertJsonObject(payload, "Token endpoint did not return a JSON object");
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!accessToken) {
    throw new OAuthTokenExchangeError(
      "INVALID_TOKEN_RESPONSE",
      "Token response is missing access_token",
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

export async function exchangeAuthorizationCodeForTokens(
  input: TokenExchangeInput,
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
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

      throw new OAuthTokenExchangeError(
        "TOKEN_EXCHANGE_FAILED",
        providerError?.description ??
          providerError?.error ??
          `Token endpoint request failed with HTTP ${response.status}`,
        {
          httpStatus: response.status === 400 ? 400 : 502,
          details,
        },
      );
    }

    return normalizeTokenResponse(parsedBody);
  } catch (error) {
    if (error instanceof OAuthTokenExchangeError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OAuthTokenExchangeError(
        "TOKEN_EXCHANGE_FAILED",
        "Token exchange request timed out",
        { httpStatus: 504, cause: error },
      );
    }

    throw new OAuthTokenExchangeError("TOKEN_EXCHANGE_FAILED", "Token exchange request failed", {
      httpStatus: 502,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}
