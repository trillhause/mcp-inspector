import "server-only";

import { randomUUID } from "node:crypto";

import { dbExecute, dbQueryFirst } from "@/lib/db";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type PersistedOAuthState = {
  id: string;
  mcp_server_id: string;
  state_value: string;
  code_verifier: string;
  client_id: string | null;
  client_secret: string | null;
  oauth_metadata: string | null;
  protected_resource_url: string | null;
  authorization_server_url: string | null;
  redirect_uri: string;
  expires_at: string;
  created_at: string;
};

type CreateOAuthStateInput = {
  mcpServerId: string;
  stateValue: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string | null;
  oauthMetadata: Record<string, unknown>;
  protectedResourceUrl: string;
  authorizationServerUrl: string;
};

export function cleanupExpiredOAuthState(now = new Date()) {
  const result = dbExecute("DELETE FROM oauth_state WHERE expires_at <= @now_iso", {
    now_iso: now.toISOString(),
  });

  return result.changes;
}

export function createOAuthState(input: CreateOAuthStateInput) {
  cleanupExpiredOAuthState();

  dbExecute("DELETE FROM oauth_state WHERE mcp_server_id = @mcp_server_id", {
    mcp_server_id: input.mcpServerId,
  });

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();

  dbExecute(
    `INSERT INTO oauth_state (
      id,
      mcp_server_id,
      state_value,
      code_verifier,
      client_id,
      client_secret,
      oauth_metadata,
      protected_resource_url,
      authorization_server_url,
      redirect_uri,
      expires_at
    ) VALUES (
      @id,
      @mcp_server_id,
      @state_value,
      @code_verifier,
      @client_id,
      @client_secret,
      @oauth_metadata,
      @protected_resource_url,
      @authorization_server_url,
      @redirect_uri,
      @expires_at
    )`,
    {
      id,
      mcp_server_id: input.mcpServerId,
      state_value: input.stateValue,
      code_verifier: input.codeVerifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      oauth_metadata: JSON.stringify(input.oauthMetadata),
      protected_resource_url: input.protectedResourceUrl,
      authorization_server_url: input.authorizationServerUrl,
      redirect_uri: input.redirectUri,
      expires_at: expiresAt,
    },
  );

  const storedState = dbQueryFirst<PersistedOAuthState>(
    "SELECT * FROM oauth_state WHERE id = ? LIMIT 1",
    [id],
  );

  if (!storedState) {
    throw new Error("Failed to persist OAuth state");
  }

  return storedState;
}
