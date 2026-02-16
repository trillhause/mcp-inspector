import { NextResponse } from "next/server";

import { dbExecute, dbQueryFirst } from "@/lib/db";
import {
  getRevocationEndpointFromMetadata,
  revokeOAuthTokens,
} from "@/lib/oauth/revocation";
import { bootstrapServerStore } from "@/lib/servers";

export const runtime = "nodejs";

type DisconnectCredentialRow = {
  client_id: string;
  client_secret: string | null;
  access_token: string;
  refresh_token: string | null;
  oauth_metadata: string | null;
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

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  bootstrapServerStore();
  const { id } = await context.params;

  const server = dbQueryFirst<{ id: string }>("SELECT id FROM mcp_servers WHERE id = ? LIMIT 1", [id]);
  if (!server) {
    return errorResponse(404, "NOT_FOUND", "Server not found");
  }

  const credentials = dbQueryFirst<DisconnectCredentialRow>(
    `SELECT
      client_id,
      client_secret,
      access_token,
      refresh_token,
      oauth_metadata
    FROM oauth_credentials
    WHERE mcp_server_id = ?
    LIMIT 1`,
    [id],
  );

  const revocationEndpoint = getRevocationEndpointFromMetadata(credentials?.oauth_metadata ?? null);
  const revocation =
    credentials && revocationEndpoint
      ? await revokeOAuthTokens({
          revocationEndpoint,
          clientId: credentials.client_id,
          clientSecret: credentials.client_secret,
          accessToken: credentials.access_token,
          refreshToken: credentials.refresh_token,
        })
      : {
          attempted: false,
          revoked: false,
          errors: [] as string[],
        };

  try {
    dbExecute("DELETE FROM oauth_state WHERE mcp_server_id = ?", [id]);
    dbExecute("DELETE FROM oauth_credentials WHERE mcp_server_id = ?", [id]);
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to disconnect server");
  }

  return NextResponse.json({
    mcp_server_id: id,
    next_action: "disconnected",
    revocation: {
      attempted: revocation.attempted,
      revoked: revocation.revoked,
      ...(revocation.errors.length > 0 ? { errors: revocation.errors } : {}),
    },
  });
}
