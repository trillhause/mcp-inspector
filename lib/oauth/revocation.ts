import "server-only";

const REVOCATION_TIMEOUT_MS = 8_000;

export type OAuthRevocationInput = {
  revocationEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  accessToken: string;
  refreshToken: string | null;
};

export type OAuthRevocationResult = {
  attempted: boolean;
  revoked: boolean;
  errors: string[];
};

function parseRevocationEndpoint(oauthMetadataJson: string | null) {
  if (!oauthMetadataJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(oauthMetadataJson) as Record<string, unknown>;
    const endpoint = parsed.revocation_endpoint;

    if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
      return null;
    }

    return endpoint.trim();
  } catch {
    return null;
  }
}

export function getRevocationEndpointFromMetadata(oauthMetadataJson: string | null) {
  return parseRevocationEndpoint(oauthMetadataJson);
}

async function revokeToken(
  endpoint: string,
  token: string,
  tokenTypeHint: "access_token" | "refresh_token",
  clientId: string,
  clientSecret: string | null,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REVOCATION_TIMEOUT_MS);

  try {
    const body = new URLSearchParams();
    body.set("token", token);
    body.set("token_type_hint", tokenTypeHint);
    body.set("client_id", clientId);

    const headers: HeadersInit = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };

    if (clientSecret) {
      const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      headers.authorization = `Basic ${encodedCredentials}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: body.toString(),
      signal: controller.signal,
    });

    if (response.ok) {
      return { ok: true as const };
    }

    return {
      ok: false as const,
      error: `revocation endpoint returned HTTP ${response.status}`,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false as const, error: "revocation request timed out" };
    }

    return { ok: false as const, error: "revocation request failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function revokeOAuthTokens(input: OAuthRevocationInput): Promise<OAuthRevocationResult> {
  const normalizedRefreshToken = input.refreshToken?.trim() ?? "";
  const normalizedAccessToken = input.accessToken.trim();
  const tokens = [
    normalizedRefreshToken.length > 0
      ? {
          token: normalizedRefreshToken,
          tokenTypeHint: "refresh_token" as const,
        }
      : null,
    normalizedAccessToken.length > 0
      ? {
          token: normalizedAccessToken,
          tokenTypeHint: "access_token" as const,
        }
      : null,
  ].filter((entry): entry is { token: string; tokenTypeHint: "access_token" | "refresh_token" } =>
    Boolean(entry),
  );

  if (tokens.length === 0) {
    return {
      attempted: false,
      revoked: false,
      errors: [],
    };
  }

  const errors: string[] = [];
  let revoked = false;

  for (const token of tokens) {
    const result = await revokeToken(
      input.revocationEndpoint,
      token.token,
      token.tokenTypeHint,
      input.clientId,
      input.clientSecret,
    );

    if (result.ok) {
      revoked = true;
      continue;
    }

    errors.push(result.error);
  }

  return {
    attempted: true,
    revoked,
    errors,
  };
}
