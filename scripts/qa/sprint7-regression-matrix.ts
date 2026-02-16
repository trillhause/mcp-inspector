import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import Database from "better-sqlite3";
import { GET as getCapabilitiesRoute } from "@/app/api/mcp/[serverId]/capabilities/route";
import { GET as getHistoryRoute } from "@/app/api/mcp/[serverId]/history/route";
import { POST as postResourceReadRoute } from "@/app/api/mcp/[serverId]/resources/read/route";
import { POST as postToolExecuteRoute } from "@/app/api/mcp/[serverId]/tools/[toolName]/execute/route";
import { POST as postRefreshRoute } from "@/app/api/oauth/refresh/route";
import { POST as postServerConnectRoute } from "@/app/api/servers/[id]/connect/route";
import { POST as postServerDisconnectRoute } from "@/app/api/servers/[id]/disconnect/route";
import { PATCH as patchServerRoute } from "@/app/api/servers/[id]/route";
import { GET as getServersRoute } from "@/app/api/servers/route";

type ScenarioStatus = "pass" | "fail" | "warn" | "skip";

type ScenarioResult = {
  scenario: string;
  status: ScenarioStatus;
  detail: string;
  evidence?: Record<string, unknown>;
};

type ProviderReport = {
  provider: string;
  scenarios: ScenarioResult[];
  summary: {
    pass: number;
    fail: number;
    warn: number;
    skip: number;
  };
};

type HttpCallResult = {
  ok: boolean;
  status: number;
  bodyText: string;
  bodyJson: unknown;
};

type ServerRecord = {
  id: string;
  name: string;
  mcp_url: string;
  transport: "auto" | "streamable_http" | "sse";
  is_enabled: boolean;
};

type CredentialRow = {
  id: string;
  mcp_server_id: string;
  client_id: string;
  client_secret: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  oauth_metadata: string;
  protected_resource_url: string | null;
  authorization_server_url: string | null;
  connected_at: string;
  last_refreshed_at: string | null;
};

type DbRowValue = string | number | null;
type DbRow = Record<string, DbRowValue>;

const PROVIDERS = ["notion", "sentry", "posthog"] as const;
const TRANSPORTS: ReadonlyArray<ServerRecord["transport"]> = [
  "auto",
  "streamable_http",
  "sse",
];

const TOOL_NEGATIVE_CODES = new Set([
  "NOT_CONNECTED",
  "AUTH_REQUIRED",
  "RECONNECT_REQUIRED",
  "TOOL_NOT_FOUND",
  "MCP_CONNECT_FAILED",
  "EXECUTION_FAILED",
  "INTERNAL_ERROR",
]);

const RESOURCE_NEGATIVE_CODES = new Set([
  "NOT_CONNECTED",
  "AUTH_REQUIRED",
  "RECONNECT_REQUIRED",
  "RESOURCE_NOT_FOUND",
  "MCP_CONNECT_FAILED",
  "READ_FAILED",
  "INTERNAL_ERROR",
]);

const CAPABILITIES_NEGATIVE_CODES = new Set([
  "NOT_CONNECTED",
  "AUTH_REQUIRED",
  "RECONNECT_REQUIRED",
  "MCP_CONNECT_FAILED",
  "EXECUTION_FAILED",
  "INTERNAL_ERROR",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readErrorCode(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const error = payload.error;
  if (!isRecord(error)) {
    return null;
  }

  return typeof error.code === "string" ? error.code : null;
}

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const error = payload.error;
  if (!isRecord(error)) {
    return null;
  }

  return typeof error.message === "string" ? error.message : null;
}

function readNextAction(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  return typeof payload.next_action === "string" ? payload.next_action : null;
}

function classifyConnectOutcome(result: HttpCallResult) {
  const nextAction = readNextAction(result.bodyJson);
  const code = readErrorCode(result.bodyJson);

  if (result.ok && nextAction) {
    return `ok:${nextAction}`;
  }

  if (!result.ok && code) {
    return `error:${result.status}:${code}`;
  }

  return `unknown:${result.status}`;
}

function summarizeScenarios(scenarios: ScenarioResult[]) {
  return scenarios.reduce(
    (accumulator, scenario) => {
      accumulator[scenario.status] += 1;
      return accumulator;
    },
    { pass: 0, fail: 0, warn: 0, skip: 0 },
  );
}

function withJsonBody(payload: unknown) {
  return {
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

async function toHttpCallResult(response: Response): Promise<HttpCallResult> {
  const bodyText = await response.text();
  let bodyJson: unknown = null;
  if (bodyText.trim().length > 0) {
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    bodyText,
    bodyJson,
  };
}

function makeRequest(path: string, init?: RequestInit) {
  const requestUrl = new URL(`http://localhost${path}`);
  return new Request(requestUrl, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
    cache: "no-store",
  });
}

async function callApi(path: string, init?: RequestInit): Promise<HttpCallResult> {
  const request = makeRequest(path, init);
  const pathname = new URL(request.url).pathname;
  const method = (init?.method ?? "GET").toUpperCase();

  let response: Response;

  if (pathname === "/api/servers" && method === "GET") {
    response = await getServersRoute();
    return toHttpCallResult(response);
  }

  const patchServerMatch = pathname.match(/^\/api\/servers\/([^/]+)$/);
  if (patchServerMatch && method === "PATCH") {
    const serverId = decodeURIComponent(patchServerMatch[1]);
    response = await patchServerRoute(request, {
      params: Promise.resolve({ id: serverId }),
    });
    return toHttpCallResult(response);
  }

  const connectMatch = pathname.match(/^\/api\/servers\/([^/]+)\/connect$/);
  if (connectMatch && method === "POST") {
    const serverId = decodeURIComponent(connectMatch[1]);
    response = await postServerConnectRoute(request, {
      params: Promise.resolve({ id: serverId }),
    });
    return toHttpCallResult(response);
  }

  const disconnectMatch = pathname.match(/^\/api\/servers\/([^/]+)\/disconnect$/);
  if (disconnectMatch && method === "POST") {
    const serverId = decodeURIComponent(disconnectMatch[1]);
    response = await postServerDisconnectRoute(request, {
      params: Promise.resolve({ id: serverId }),
    });
    return toHttpCallResult(response);
  }

  const capabilitiesMatch = pathname.match(/^\/api\/mcp\/([^/]+)\/capabilities$/);
  if (capabilitiesMatch && method === "GET") {
    const serverId = decodeURIComponent(capabilitiesMatch[1]);
    response = await getCapabilitiesRoute(request, {
      params: Promise.resolve({ serverId }),
    });
    return toHttpCallResult(response);
  }

  const historyMatch = pathname.match(/^\/api\/mcp\/([^/]+)\/history$/);
  if (historyMatch && method === "GET") {
    const serverId = decodeURIComponent(historyMatch[1]);
    response = await getHistoryRoute(request, {
      params: Promise.resolve({ serverId }),
    });
    return toHttpCallResult(response);
  }

  const resourceReadMatch = pathname.match(/^\/api\/mcp\/([^/]+)\/resources\/read$/);
  if (resourceReadMatch && method === "POST") {
    const serverId = decodeURIComponent(resourceReadMatch[1]);
    response = await postResourceReadRoute(request, {
      params: Promise.resolve({ serverId }),
    });
    return toHttpCallResult(response);
  }

  const toolExecuteMatch = pathname.match(/^\/api\/mcp\/([^/]+)\/tools\/([^/]+)\/execute$/);
  if (toolExecuteMatch && method === "POST") {
    const serverId = decodeURIComponent(toolExecuteMatch[1]);
    const toolName = decodeURIComponent(toolExecuteMatch[2]);
    response = await postToolExecuteRoute(request, {
      params: Promise.resolve({ serverId, toolName }),
    });
    return toHttpCallResult(response);
  }

  if (pathname === "/api/oauth/refresh" && method === "POST") {
    response = await postRefreshRoute(request);
    return toHttpCallResult(response);
  }

  throw new Error(`No route mapping for ${method} ${pathname}`);
}

function nextTransport(current: ServerRecord["transport"]) {
  const currentIndex = TRANSPORTS.indexOf(current);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % TRANSPORTS.length : 0;
  return TRANSPORTS[nextIndex];
}

async function patchServer(serverId: string, payload: Record<string, unknown>) {
  return callApi(`/api/servers/${encodeURIComponent(serverId)}`, {
    method: "PATCH",
    ...withJsonBody(payload),
  });
}

function buildSyntheticCredentialRow(serverId: string): CredentialRow {
  const now = new Date();
  const expired = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  return {
    id: `qa-credential-${randomUUID()}`,
    mcp_server_id: serverId,
    client_id: "qa-client-id",
    client_secret: null,
    access_token: "qa-expired-access-token",
    refresh_token: null,
    token_expires_at: expired,
    scopes: "read write",
    oauth_metadata: JSON.stringify({
      issuer: "https://qa.invalid",
      token_endpoint: "https://qa.invalid/token",
    }),
    protected_resource_url: "https://qa.invalid/resource",
    authorization_server_url: "https://qa.invalid",
    connected_at: now.toISOString(),
    last_refreshed_at: null,
  };
}

function insertDbRow(db: Database.Database, tableName: string, row: DbRow) {
  const columns = Object.keys(row);
  if (columns.length === 0) {
    return;
  }

  const sql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${columns.map((column) => `@${column}`).join(", ")})`;
  db.prepare(sql).run(row);
}

function restoreCredentialRow(db: Database.Database, row: CredentialRow | undefined) {
  db.prepare("DELETE FROM oauth_credentials WHERE mcp_server_id = ?").run(row?.mcp_server_id);
  if (!row) {
    return;
  }

  insertDbRow(db, "oauth_credentials", row);
}

async function runProviderMatrix(
  server: ServerRecord | undefined,
  options: { dbPath: string; runId: string },
): Promise<ProviderReport> {
  const scenarios: ScenarioResult[] = [];
  if (!server) {
    scenarios.push({
      scenario: "provider-present-in-server-list",
      status: "fail",
      detail: "Provider was not returned by GET /api/servers",
    });

    return {
      provider: "unknown",
      scenarios,
      summary: summarizeScenarios(scenarios),
    };
  }

  const provider = server.id;
  const originalTransport = server.transport;
  const originalEnabled = server.is_enabled;
  const toolProbeName = `qa_nonexistent_tool_${options.runId}`;
  const resourceProbeUri = `qa://resource/${options.runId}`;

  const db = new Database(options.dbPath, { readonly: false });
  const backupServerRow = db
    .prepare(
      "SELECT transport, is_enabled, auth_mode FROM mcp_servers WHERE id = ? LIMIT 1",
    )
    .get(provider) as
    | {
        transport: ServerRecord["transport"];
        is_enabled: number;
        auth_mode: string;
      }
    | undefined;
  const backupCredential = db
    .prepare("SELECT * FROM oauth_credentials WHERE mcp_server_id = ? LIMIT 1")
    .get(provider) as DbRow | undefined;
  const backupOAuthStateRows = db
    .prepare("SELECT * FROM oauth_state WHERE mcp_server_id = ?")
    .all(provider) as DbRow[];
  const backupCapabilitiesRow = db
    .prepare("SELECT * FROM mcp_capabilities WHERE mcp_server_id = ? LIMIT 1")
    .get(provider) as DbRow | undefined;
  db.close();

  const push = (
    scenario: string,
    status: ScenarioStatus,
    detail: string,
    evidence?: Record<string, unknown>,
  ) => {
    scenarios.push({ scenario, status, detail, evidence });
  };

  try {
    push(
      "provider-present-in-server-list",
      "pass",
      "Provider is available for matrix execution",
      { provider, mcp_url: server.mcp_url },
    );

    const guardrailResponse = await patchServer(provider, {
      name: "QA Guardrail Rename Attempt",
    });
    if (guardrailResponse.status === 403 && readErrorCode(guardrailResponse.bodyJson) === "FORBIDDEN") {
      push(
        "settings-guardrail-name-read-only",
        "pass",
        "Pre-configured name edit blocked with FORBIDDEN guardrail",
      );
    } else {
      push(
        "settings-guardrail-name-read-only",
        "fail",
        "Expected FORBIDDEN guardrail when editing pre-configured name",
        {
          status: guardrailResponse.status,
          code: readErrorCode(guardrailResponse.bodyJson),
          message: readErrorMessage(guardrailResponse.bodyJson),
        },
      );
    }

    const transportCandidate = nextTransport(originalTransport);
    const transportUpdateResponse = await patchServer(provider, {
      transport: transportCandidate,
    });
    const transportUpdateServer =
      isRecord(transportUpdateResponse.bodyJson) && isRecord(transportUpdateResponse.bodyJson.server)
        ? transportUpdateResponse.bodyJson.server
        : null;
    if (transportUpdateResponse.ok && transportUpdateServer?.transport === transportCandidate) {
      push(
        "settings-transport-update",
        "pass",
        "Transport persisted via PATCH /api/servers/[id]",
        { from: originalTransport, to: transportCandidate },
      );
    } else {
      push(
        "settings-transport-update",
        "fail",
        "Transport update did not persist expected value",
        {
          status: transportUpdateResponse.status,
          code: readErrorCode(transportUpdateResponse.bodyJson),
          message: readErrorMessage(transportUpdateResponse.bodyJson),
          expected: transportCandidate,
          actual: transportUpdateServer?.transport ?? null,
        },
      );
    }

    const disableResponse = await patchServer(provider, { is_enabled: false });
    const enableResponse = await patchServer(provider, { is_enabled: true });
    const disabledServer =
      isRecord(disableResponse.bodyJson) && isRecord(disableResponse.bodyJson.server)
        ? disableResponse.bodyJson.server
        : null;
    const enabledServer =
      isRecord(enableResponse.bodyJson) && isRecord(enableResponse.bodyJson.server)
        ? enableResponse.bodyJson.server
        : null;
    if (
      disableResponse.ok &&
      enableResponse.ok &&
      disabledServer?.is_enabled === false &&
      enabledServer?.is_enabled === true
    ) {
      push(
        "settings-enabled-toggle",
        "pass",
        "Enabled state can be toggled and restored",
      );
    } else {
      push(
        "settings-enabled-toggle",
        "fail",
        "Enabled toggle did not produce expected state transitions",
        {
          disable_status: disableResponse.status,
          enable_status: enableResponse.status,
          disabled_state: disabledServer?.is_enabled ?? null,
          enabled_state: enabledServer?.is_enabled ?? null,
        },
      );
    }

    const historyInitialResponse = await callApi(
      `/api/mcp/${encodeURIComponent(provider)}/history?limit=5`,
      { method: "GET" },
    );
    const initialHistoryItems =
      isRecord(historyInitialResponse.bodyJson) && Array.isArray(historyInitialResponse.bodyJson.items)
        ? historyInitialResponse.bodyJson.items
        : null;
    if (historyInitialResponse.ok && initialHistoryItems) {
      push(
        "history-list-fetch",
        "pass",
        "History endpoint returned a valid list response",
        { item_count: initialHistoryItems.length },
      );
    } else {
      push(
        "history-list-fetch",
        "fail",
        "History endpoint did not return expected payload shape",
        {
          status: historyInitialResponse.status,
          code: readErrorCode(historyInitialResponse.bodyJson),
          message: readErrorMessage(historyInitialResponse.bodyJson),
        },
      );
    }

    const capabilitiesResponse = await callApi(
      `/api/mcp/${encodeURIComponent(provider)}/capabilities`,
      { method: "GET" },
    );
    const capabilitiesCode = readErrorCode(capabilitiesResponse.bodyJson);
    if (
      capabilitiesResponse.ok ||
      (capabilitiesCode !== null && CAPABILITIES_NEGATIVE_CODES.has(capabilitiesCode))
    ) {
      push(
        "capabilities-fetch-and-retryable-state",
        "pass",
        "Capabilities route returned either data or a mapped actionable error",
        {
          status: capabilitiesResponse.status,
          code: capabilitiesCode,
          ok: capabilitiesResponse.ok,
        },
      );
    } else {
      push(
        "capabilities-fetch-and-retryable-state",
        "fail",
        "Capabilities route returned an unmapped failure",
        {
          status: capabilitiesResponse.status,
          body: capabilitiesResponse.bodyText.slice(0, 300),
        },
      );
    }

    const connectAttemptOne = await callApi(
      `/api/servers/${encodeURIComponent(provider)}/connect`,
      { method: "POST" },
    );
    const connectAttemptTwo = await callApi(
      `/api/servers/${encodeURIComponent(provider)}/connect`,
      { method: "POST" },
    );

    const connectOutcomeOne = classifyConnectOutcome(connectAttemptOne);
    const connectOutcomeTwo = classifyConnectOutcome(connectAttemptTwo);
    const connectOneAction = readNextAction(connectAttemptOne.bodyJson);
    const connectTwoAction = readNextAction(connectAttemptTwo.bodyJson);
    const connectOneCode = readErrorCode(connectAttemptOne.bodyJson);
    const connectTwoCode = readErrorCode(connectAttemptTwo.bodyJson);
    const connectAttemptOneActionable =
      (connectAttemptOne.ok && (connectOneAction === "redirect" || connectOneAction === "direct_connect")) ||
      (!connectAttemptOne.ok && Boolean(connectOneCode));
    const connectAttemptTwoActionable =
      (connectAttemptTwo.ok && (connectTwoAction === "redirect" || connectTwoAction === "direct_connect")) ||
      (!connectAttemptTwo.ok && Boolean(connectTwoCode));

    if (connectAttemptOneActionable && connectAttemptTwoActionable && connectOutcomeOne === connectOutcomeTwo) {
      push(
        "connect-retry-determinism",
        "pass",
        "Repeated connect attempts produced deterministic, actionable outcomes",
        {
          attempt_1: connectOutcomeOne,
          attempt_2: connectOutcomeTwo,
        },
      );
    } else if (connectAttemptOneActionable && connectAttemptTwoActionable) {
      push(
        "connect-retry-determinism",
        "warn",
        "Connect outcomes were actionable but changed across retries",
        {
          attempt_1: connectOutcomeOne,
          attempt_2: connectOutcomeTwo,
        },
      );
    } else {
      push(
        "connect-retry-determinism",
        "fail",
        "Connect retries did not produce actionable outcomes",
        {
          attempt_1_status: connectAttemptOne.status,
          attempt_1_code: connectOneCode,
          attempt_2_status: connectAttemptTwo.status,
          attempt_2_code: connectTwoCode,
        },
      );
    }

    const disconnectResponse = await callApi(
      `/api/servers/${encodeURIComponent(provider)}/disconnect`,
      { method: "POST" },
    );
    if (disconnectResponse.ok && readNextAction(disconnectResponse.bodyJson) === "disconnected") {
      push(
        "disconnect-flow",
        "pass",
        "Disconnect endpoint completed and returned disconnected next_action",
      );
    } else {
      push(
        "disconnect-flow",
        "fail",
        "Disconnect endpoint did not return expected success payload",
        {
          status: disconnectResponse.status,
          code: readErrorCode(disconnectResponse.bodyJson),
          message: readErrorMessage(disconnectResponse.bodyJson),
        },
      );
    }

    const toolExecuteResponse = await callApi(
      `/api/mcp/${encodeURIComponent(provider)}/tools/${encodeURIComponent(toolProbeName)}/execute`,
      {
        method: "POST",
        ...withJsonBody({
          arguments: {
            probe: "qa-matrix",
          },
        }),
      },
    );
    const toolCode = readErrorCode(toolExecuteResponse.bodyJson);
    if (!toolExecuteResponse.ok && toolCode && TOOL_NEGATIVE_CODES.has(toolCode)) {
      push(
        "tool-execution-negative-path",
        "pass",
        "Tool execution returned an actionable error code for negative-path input",
        { code: toolCode, status: toolExecuteResponse.status },
      );
    } else {
      push(
        "tool-execution-negative-path",
        "fail",
        "Tool execution did not return an expected negative-path error",
        {
          status: toolExecuteResponse.status,
          code: toolCode,
          body: toolExecuteResponse.bodyText.slice(0, 300),
        },
      );
    }

    const resourceReadResponse = await callApi(
      `/api/mcp/${encodeURIComponent(provider)}/resources/read`,
      {
        method: "POST",
        ...withJsonBody({
          uri: resourceProbeUri,
        }),
      },
    );
    const resourceCode = readErrorCode(resourceReadResponse.bodyJson);
    if (!resourceReadResponse.ok && resourceCode && RESOURCE_NEGATIVE_CODES.has(resourceCode)) {
      push(
        "resource-read-negative-path",
        "pass",
        "Resource read returned an actionable error code for negative-path input",
        { code: resourceCode, status: resourceReadResponse.status },
      );
    } else {
      push(
        "resource-read-negative-path",
        "fail",
        "Resource read did not return an expected negative-path error",
        {
          status: resourceReadResponse.status,
          code: resourceCode,
          body: resourceReadResponse.bodyText.slice(0, 300),
        },
      );
    }

    const historyAfterActivityResponse = await callApi(
      `/api/mcp/${encodeURIComponent(provider)}/history?limit=25`,
      { method: "GET" },
    );
    const activityItems =
      isRecord(historyAfterActivityResponse.bodyJson) && Array.isArray(historyAfterActivityResponse.bodyJson.items)
        ? historyAfterActivityResponse.bodyJson.items
        : [];
    const hasToolRecord = activityItems.some(
      (item) =>
        isRecord(item) &&
        isRecord(item.target) &&
        item.target.value === toolProbeName &&
        item.action_type === "tool_execute",
    );
    const hasResourceRecord = activityItems.some(
      (item) =>
        isRecord(item) &&
        isRecord(item.target) &&
        item.target.value === resourceProbeUri &&
        item.action_type === "resource_read",
    );
    if (historyAfterActivityResponse.ok && hasToolRecord && hasResourceRecord) {
      push(
        "history-drilldown-data-available",
        "pass",
        "History includes latest tool/resource entries for drilldown",
        {
          tool_entry: hasToolRecord,
          resource_entry: hasResourceRecord,
          total_items: activityItems.length,
        },
      );
    } else {
      push(
        "history-drilldown-data-available",
        "fail",
        "History did not include expected tool/resource entries",
        {
          status: historyAfterActivityResponse.status,
          total_items: activityItems.length,
          tool_entry: hasToolRecord,
          resource_entry: hasResourceRecord,
        },
      );
    }
  } finally {
    await patchServer(provider, {
      transport: originalTransport,
      is_enabled: originalEnabled,
    }).catch(() => undefined);

    const restoreDb = new Database(options.dbPath, { readonly: false });
    try {
      restoreDb
        .prepare(
          `DELETE FROM mcp_execution_history
           WHERE mcp_server_id = @mcp_server_id
             AND target_value IN (@tool_target, @resource_target)`,
        )
        .run({
          mcp_server_id: provider,
          tool_target: toolProbeName,
          resource_target: resourceProbeUri,
        });

      if (backupServerRow) {
        restoreDb
          .prepare(
            `UPDATE mcp_servers
             SET transport = @transport,
                 is_enabled = @is_enabled,
                 auth_mode = @auth_mode,
                 updated_at = datetime('now')
             WHERE id = @id`,
          )
          .run({
            id: provider,
            transport: backupServerRow.transport,
            is_enabled: backupServerRow.is_enabled,
            auth_mode: backupServerRow.auth_mode,
          });
      }

      restoreDb.prepare("DELETE FROM oauth_state WHERE mcp_server_id = ?").run(provider);
      for (const stateRow of backupOAuthStateRows) {
        insertDbRow(restoreDb, "oauth_state", stateRow);
      }

      restoreDb.prepare("DELETE FROM oauth_credentials WHERE mcp_server_id = ?").run(provider);
      if (backupCredential) {
        insertDbRow(restoreDb, "oauth_credentials", backupCredential);
      }

      restoreDb.prepare("DELETE FROM mcp_capabilities WHERE mcp_server_id = ?").run(provider);
      if (backupCapabilitiesRow) {
        insertDbRow(restoreDb, "mcp_capabilities", backupCapabilitiesRow);
      }
    } finally {
      restoreDb.close();
    }
  }

  return {
    provider,
    scenarios,
    summary: summarizeScenarios(scenarios),
  };
}

async function runTokenExpirySimulation(
  dbPath: string,
  providerId: string,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const db = new Database(dbPath, { readonly: false });

  const push = (
    scenario: string,
    status: ScenarioStatus,
    detail: string,
    evidence?: Record<string, unknown>,
  ) => {
    results.push({ scenario, status, detail, evidence });
  };

  const existingCredential = db
    .prepare("SELECT * FROM oauth_credentials WHERE mcp_server_id = ? LIMIT 1")
    .get(providerId) as CredentialRow | undefined;

  try {
    const synthetic = buildSyntheticCredentialRow(providerId);
    db.prepare("DELETE FROM oauth_credentials WHERE mcp_server_id = ?").run(providerId);
    db.prepare(
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
      )`,
    ).run(synthetic);

    const refreshResponse = await callApi("/api/oauth/refresh", {
      method: "POST",
      ...withJsonBody({
        mcp_server_id: providerId,
        force: true,
      }),
    });
    const refreshStatus =
      isRecord(refreshResponse.bodyJson) && typeof refreshResponse.bodyJson.status === "string"
        ? refreshResponse.bodyJson.status
        : null;
    const connectionStatus =
      isRecord(refreshResponse.bodyJson) && typeof refreshResponse.bodyJson.connection_status === "string"
        ? refreshResponse.bodyJson.connection_status
        : null;
    if (refreshResponse.ok && refreshStatus === "reconnect_required" && connectionStatus === "expired") {
      push(
        "token-expiry-refresh-reconnect-required",
        "pass",
        "Forced refresh transitioned to reconnect_required for expired credentials",
      );
    } else {
      push(
        "token-expiry-refresh-reconnect-required",
        "fail",
        "Forced refresh did not transition to reconnect_required",
        {
          status: refreshResponse.status,
          refresh_status: refreshStatus,
          connection_status: connectionStatus,
          code: readErrorCode(refreshResponse.bodyJson),
        },
      );
    }

    const capabilitiesResponse = await callApi(
      `/api/mcp/${encodeURIComponent(providerId)}/capabilities`,
      { method: "GET" },
    );
    const capabilitiesCode = readErrorCode(capabilitiesResponse.bodyJson);
    const staleReason =
      isRecord(capabilitiesResponse.bodyJson) &&
      typeof capabilitiesResponse.bodyJson.stale_reason === "string"
        ? capabilitiesResponse.bodyJson.stale_reason
        : null;
    if (
      (!capabilitiesResponse.ok && capabilitiesCode === "RECONNECT_REQUIRED") ||
      (capabilitiesResponse.ok && staleReason === "reconnect_required")
    ) {
      push(
        "token-expiry-capabilities-reconnect-state",
        "pass",
        "Capabilities path reflected reconnect-required token lifecycle state",
        {
          status: capabilitiesResponse.status,
          code: capabilitiesCode,
          stale_reason: staleReason,
        },
      );
    } else {
      push(
        "token-expiry-capabilities-reconnect-state",
        "fail",
        "Capabilities path did not expose reconnect-required token lifecycle state",
        {
          status: capabilitiesResponse.status,
          code: capabilitiesCode,
          stale_reason: staleReason,
        },
      );
    }
  } finally {
    restoreCredentialRow(db, existingCredential);
    db.close();
  }

  return results;
}

async function runConcurrentCapabilitiesProbe(providerIds: readonly string[]) {
  const responses = await Promise.all(
    providerIds.map(async (providerId) => {
      const response = await callApi(
        `/api/mcp/${encodeURIComponent(providerId)}/capabilities?refresh=1`,
        { method: "GET" },
      );
      return {
        providerId,
        status: response.status,
        ok: response.ok,
        code: readErrorCode(response.bodyJson),
      };
    }),
  );

  const allActionable = responses.every(
    (response) =>
      response.ok || (response.code !== null && CAPABILITIES_NEGATIVE_CODES.has(response.code)),
  );

  return {
    scenario: "cross-server-in-flight-capabilities",
    status: allActionable ? ("pass" as const) : ("fail" as const),
    detail: allActionable
      ? "Concurrent capabilities requests returned actionable outcomes across providers"
      : "Concurrent capabilities requests produced at least one unmapped outcome",
    evidence: {
      responses,
    },
  };
}

async function runUiContractSmokeChecks(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const push = (
    scenario: string,
    status: ScenarioStatus,
    detail: string,
    evidence?: Record<string, unknown>,
  ) => {
    results.push({ scenario, status, detail, evidence });
  };

  const [homePageSource, historyWorkspaceSource, settingsWorkspaceSource] = await Promise.all([
    readFile(join(process.cwd(), "app", "page.tsx"), "utf8"),
    readFile(join(process.cwd(), "components", "execution-history-workspace.tsx"), "utf8"),
    readFile(join(process.cwd(), "components", "server-settings-workspace.tsx"), "utf8"),
  ]);

  const keyboardEscapeHandled =
    homePageSource.includes('event.key !== "Escape"') &&
    homePageSource.includes("window.addEventListener(\"keydown\", handleKeyDown)");
  const filterAriaLabelsPresent =
    historyWorkspaceSource.includes("aria-label=\"Filter execution history by action type\"") &&
    historyWorkspaceSource.includes("aria-label=\"Filter execution history by status\"");
  const settingsLabelsPresent =
    settingsWorkspaceSource.includes("Label htmlFor=\"server-settings-name\"") &&
    settingsWorkspaceSource.includes("Label htmlFor=\"server-settings-transport\"") &&
    settingsWorkspaceSource.includes("Label htmlFor=\"server-settings-enabled\"");

  if (keyboardEscapeHandled && filterAriaLabelsPresent && settingsLabelsPresent) {
    push(
      "accessibility-smoke-keyboard-and-labels",
      "pass",
      "Keyboard escape handling, filter aria-labels, and settings form labels are present in UI contracts",
    );
  } else {
    push(
      "accessibility-smoke-keyboard-and-labels",
      "fail",
      "One or more accessibility contract checks failed",
      {
        keyboard_escape: keyboardEscapeHandled,
        filter_aria_labels: filterAriaLabelsPresent,
        settings_labels: settingsLabelsPresent,
      },
    );
  }

  const responsiveShellClassesPresent =
    homePageSource.includes("hidden md:flex") &&
    homePageSource.includes("md:hidden") &&
    homePageSource.includes("<Sheet open={isServerSheetOpen}");
  if (responsiveShellClassesPresent) {
    push(
      "responsive-smoke-desktop-mobile-shell",
      "pass",
      "Desktop sidebar and mobile sheet toggles are both present in the shell layout",
    );
  } else {
    push(
      "responsive-smoke-desktop-mobile-shell",
      "fail",
      "Responsive shell contract markers were not found",
      {
        has_desktop_sidebar_class: homePageSource.includes("hidden md:flex"),
        has_mobile_only_class: homePageSource.includes("md:hidden"),
        has_mobile_sheet: homePageSource.includes("<Sheet open={isServerSheetOpen}"),
      },
    );
  }

  return results;
}

function toMarkdownTable(report: {
  providerReports: ProviderReport[];
  edgeCaseResults: ScenarioResult[];
}) {
  const lines: string[] = [];

  lines.push("| Provider | Pass | Warn | Fail | Skip |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const providerReport of report.providerReports) {
    lines.push(
      `| ${providerReport.provider} | ${providerReport.summary.pass} | ${providerReport.summary.warn} | ${providerReport.summary.fail} | ${providerReport.summary.skip} |`,
    );
  }

  lines.push("");
  lines.push("| Edge Case Scenario | Status | Detail |");
  lines.push("|---|---|---|");
  for (const scenario of report.edgeCaseResults) {
    lines.push(`| ${scenario.scenario} | ${scenario.status} | ${scenario.detail} |`);
  }

  return lines.join("\n");
}

async function main() {
  const dbPath = process.env.MCP_CLIENT_DB_PATH ?? "data/mcp-client.db";

  const serversResponse = await callApi("/api/servers", { method: "GET" });
  if (!serversResponse.ok || !isRecord(serversResponse.bodyJson) || !Array.isArray(serversResponse.bodyJson.servers)) {
    throw new Error(
      `Failed to load servers from route invocation (/api/servers) (status=${serversResponse.status})`,
    );
  }

  const servers = serversResponse.bodyJson.servers
    .filter((server): server is ServerRecord => {
      if (!isRecord(server)) {
        return false;
      }

      return (
        typeof server.id === "string" &&
        typeof server.name === "string" &&
        typeof server.mcp_url === "string" &&
        (server.transport === "auto" ||
          server.transport === "streamable_http" ||
          server.transport === "sse") &&
        typeof server.is_enabled === "boolean"
      );
    });
  const serverById = new Map(servers.map((server) => [server.id, server]));
  const runId = randomUUID();

  const providerReports: ProviderReport[] = [];
  for (const providerId of PROVIDERS) {
    const providerServer = serverById.get(providerId);
    const providerReport = await runProviderMatrix(providerServer, { dbPath, runId });
    providerReports.push({
      ...providerReport,
      provider: providerId,
    });
  }

  const edgeCaseResults: ScenarioResult[] = [];
  edgeCaseResults.push(await runConcurrentCapabilitiesProbe(PROVIDERS));
  edgeCaseResults.push(...(await runTokenExpirySimulation(dbPath, "notion")));
  edgeCaseResults.push(...(await runUiContractSmokeChecks()));

  const summary = providerReports.reduce(
    (accumulator, report) => {
      accumulator.pass += report.summary.pass;
      accumulator.fail += report.summary.fail;
      accumulator.warn += report.summary.warn;
      accumulator.skip += report.summary.skip;
      return accumulator;
    },
    { pass: 0, fail: 0, warn: 0, skip: 0 },
  );
  const edgeSummary = summarizeScenarios(edgeCaseResults);

  const output = {
    generated_at: new Date().toISOString(),
    execution_mode: "in-process-route-invocation",
    db_path: dbPath,
    providers: [...PROVIDERS],
    provider_reports: providerReports,
    provider_summary: summary,
    edge_case_results: edgeCaseResults,
    edge_case_summary: edgeSummary,
  };

  const docsDir = join(process.cwd(), ".docs", "sprint-7");
  await mkdir(docsDir, { recursive: true });
  const jsonOutputPath = join(docsDir, "regression-matrix-results.json");
  const markdownOutputPath = join(docsDir, "regression-matrix-summary.md");

  await writeFile(jsonOutputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(
    markdownOutputPath,
    `${toMarkdownTable({ providerReports, edgeCaseResults })}\n`,
    "utf8",
  );

  console.log(`Saved regression matrix JSON: ${jsonOutputPath}`);
  console.log(`Saved regression matrix summary: ${markdownOutputPath}`);
  console.log(
    `Provider summary: pass=${summary.pass} warn=${summary.warn} fail=${summary.fail} skip=${summary.skip}`,
  );
  console.log(
    `Edge case summary: pass=${edgeSummary.pass} warn=${edgeSummary.warn} fail=${edgeSummary.fail} skip=${edgeSummary.skip}`,
  );

  if (summary.fail > 0 || edgeSummary.fail > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
