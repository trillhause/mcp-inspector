import "server-only";

import { randomUUID } from "node:crypto";

import { dbExecute } from "@/lib/db";

type UpsertOAuthCredentialsInput = {
  mcpServerId: string;
  clientId: string;
  clientSecret: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
  oauthMetadata: Record<string, unknown>;
  protectedResourceUrl: string | null;
  authorizationServerUrl: string | null;
};

export type UpsertOAuthCredentialsResult = {
  tokenExpiresAt: string | null;
  connectedAt: string;
};

function resolveTokenExpiresAt(expiresInSeconds: number | null, now = new Date()) {
  if (!expiresInSeconds || expiresInSeconds <= 0) {
    return null;
  }

  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

export function upsertOAuthCredentials(
  input: UpsertOAuthCredentialsInput,
): UpsertOAuthCredentialsResult {
  const connectedAt = new Date().toISOString();
  const tokenExpiresAt = resolveTokenExpiresAt(input.expiresIn, new Date(connectedAt));
  const id = randomUUID();

  dbExecute(
    `INSERT INTO oauth_credentials (
      id,
      mcp_server_id,
      client_id,
      client_secret,
      access_token,
      refresh_token,
      token_expires_at,
      scopes,
      oauth_metadata,
      protected_resource_url,
      authorization_server_url,
      connected_at,
      last_refreshed_at
    ) VALUES (
      @id,
      @mcp_server_id,
      @client_id,
      @client_secret,
      @access_token,
      @refresh_token,
      @token_expires_at,
      @scopes,
      @oauth_metadata,
      @protected_resource_url,
      @authorization_server_url,
      @connected_at,
      @last_refreshed_at
    )
    ON CONFLICT(mcp_server_id) DO UPDATE SET
      client_id = excluded.client_id,
      client_secret = excluded.client_secret,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expires_at = excluded.token_expires_at,
      scopes = excluded.scopes,
      oauth_metadata = excluded.oauth_metadata,
      protected_resource_url = excluded.protected_resource_url,
      authorization_server_url = excluded.authorization_server_url,
      connected_at = excluded.connected_at,
      last_refreshed_at = excluded.last_refreshed_at`,
    {
      id,
      mcp_server_id: input.mcpServerId,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
      token_expires_at: tokenExpiresAt,
      scopes: input.scope,
      oauth_metadata: JSON.stringify(input.oauthMetadata),
      protected_resource_url: input.protectedResourceUrl,
      authorization_server_url: input.authorizationServerUrl,
      connected_at: connectedAt,
      last_refreshed_at: connectedAt,
    },
  );

  return {
    tokenExpiresAt,
    connectedAt,
  };
}
