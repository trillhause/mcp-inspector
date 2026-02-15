"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";

import {
  CapabilityEmptyState,
  PromptCapabilityRow,
  type PromptCapability,
  type ResourceCapability,
  type ToolCapability,
} from "@/components/capability-list-rows";
import { ExecutionHistoryWorkspace } from "@/components/execution-history-workspace";
import {
  LoadingSection,
  SkeletonCard,
} from "@/components/loading-state-primitives";
import { ResourceReadingWorkspace } from "@/components/resource-reading-workspace";
import { ServerSettingsWorkspace } from "@/components/server-settings-workspace";
import { ToolExecutionWorkspace } from "@/components/tool-execution-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildMcpSurfaceErrorDiagnostics,
  normalizeMcpSurfaceError,
  resolveMcpSurfaceErrorAction,
  type McpSurfaceError,
} from "@/lib/mcp/interaction-error-ui";
import type {
  McpInteractionErrorCode,
  McpSurfaceState,
} from "@/lib/mcp/interaction-contract";
import type {
  ConnectionStatus,
  McpServer,
  TokenLifecycleState,
} from "@/lib/types";

type ServerDetailsPanelProps = {
  selectedServer: McpServer;
  onConnect?: (serverId: string) => void;
  onDisconnect?: (serverId: string) => void;
  onTokenLifecycleUpdated?: (
    serverId: string,
    next: Pick<
      McpServer,
      "connection_status" | "connected_at" | "token_expires_at" | "token_lifecycle_state"
    >,
  ) => void;
  onCapabilitiesLoaded?: (
    serverId: string,
    counts: { tools: number; resources: number },
  ) => void;
  onServerUpdated?: (server: McpServer) => void;
  isConnecting?: boolean;
  isDisconnecting?: boolean;
};

type CapabilitiesApiError = {
  code: string;
  category?: string;
  message: string;
  details?: string[];
  stale?: boolean;
};

type CapabilitiesSurfaceError = McpSurfaceError & {
  source: "server" | "network" | "client";
  failedAt: string;
};

type CapabilitiesApiPayload = {
  mcp_server_id: string;
  tools: ToolCapability[];
  resources: ResourceCapability[];
  prompts: PromptCapability[];
  tools_count: number;
  resources_count: number;
  prompts_count: number;
  cached: boolean;
  last_discovered_at: string;
  stale: boolean;
  stale_reason: string | null;
  stale_message: string | null;
  cache_age_ms: number | null;
  cache_ttl_ms: number | null;
  background_refresh_scheduled: boolean;
  error?: CapabilitiesApiError;
};

type RefreshTokenSuccessPayload = {
  mcp_server_id: string;
  status: "connected" | "reconnect_required";
  connection_status: ConnectionStatus;
  refreshed: boolean;
  refresh_reason: string;
  connected_at: string | null;
  token_expires_at: string | null;
  token_lifecycle_state: TokenLifecycleState;
  last_refreshed_at: string | null;
};

type CapabilitiesTab = "tools" | "resources" | "prompts" | "history" | "settings";
const CAPABILITIES_REQUEST_TIMEOUT_MS = 20_000;
const SURFACE_STATE_LABELS: Record<McpSurfaceState, string> = {
  idle: "Idle",
  loading: "Loading",
  success: "Ready",
  empty: "Empty",
  stale: "Stale",
  error: "Error",
};

const STATUS_STYLES: Record<
  ConnectionStatus,
  { label: string; className: string }
> = {
  disconnected: {
    label: "Not Connected",
    className: "bg-muted text-muted-foreground",
  },
  connected: {
    label: "Connected",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  expired: {
    label: "Reconnect",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
};

export function ServerDetailsPanel({
  selectedServer,
  onConnect,
  onDisconnect,
  onTokenLifecycleUpdated,
  onCapabilitiesLoaded,
  onServerUpdated,
  isConnecting = false,
  isDisconnecting = false,
}: ServerDetailsPanelProps) {
  return (
    <div className="flex h-full flex-col" aria-label="Server details">
      <SelectedServerContent
        server={selectedServer}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onTokenLifecycleUpdated={onTokenLifecycleUpdated}
        onCapabilitiesLoaded={onCapabilitiesLoaded}
        onServerUpdated={onServerUpdated}
        isConnecting={isConnecting}
        isDisconnecting={isDisconnecting}
      />
    </div>
  );
}

function SelectedServerContent({
  server,
  onConnect,
  onDisconnect,
  onTokenLifecycleUpdated,
  onCapabilitiesLoaded,
  onServerUpdated,
  isConnecting,
  isDisconnecting,
}: {
  server: McpServer;
  onConnect?: (serverId: string) => void;
  onDisconnect?: (serverId: string) => void;
  onTokenLifecycleUpdated?: (
    serverId: string,
    next: Pick<
      McpServer,
      "connection_status" | "connected_at" | "token_expires_at" | "token_lifecycle_state"
    >,
  ) => void;
  onCapabilitiesLoaded?: (
    serverId: string,
    counts: { tools: number; resources: number },
  ) => void;
  onServerUpdated?: (server: McpServer) => void;
  isConnecting: boolean;
  isDisconnecting: boolean;
}) {
  const [activeTab, setActiveTab] = useState<CapabilitiesTab>("tools");
  const [capabilities, setCapabilities] = useState<CapabilitiesApiPayload | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<CapabilitiesSurfaceError | null>(null);
  const [capabilitiesWarning, setCapabilitiesWarning] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(false);
  const [isRefreshingCapabilities, setIsRefreshingCapabilities] = useState(false);
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);
  const [tokenLifecycleNotice, setTokenLifecycleNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const capabilitiesRef = useRef<CapabilitiesApiPayload | null>(null);
  const capabilitiesCacheRef = useRef<Map<string, CapabilitiesApiPayload>>(new Map());

  const status = STATUS_STYLES[server.connection_status];
  const isServerDisabled = !server.is_enabled;
  const isConnected = server.connection_status === "connected";
  const canInspectCapabilities = server.is_enabled && server.connection_status !== "disconnected";
  const canManualRefreshCapabilities = canInspectCapabilities && server.connection_status !== "expired";
  const isBusy = isConnecting || isDisconnecting || isRefreshingToken;
  const isTokenExpiringSoon = server.token_lifecycle_state === "expiring_soon";
  const isTokenExpired = server.connection_status === "expired" || server.token_lifecycle_state === "expired";
  const showTokenLifecycleWarning =
    server.auth_mode === "oauth" && server.is_enabled && (isTokenExpiringSoon || isTokenExpired);
  const tokenLifecycleBannerMessage = useMemo(() => {
    if (isTokenExpired) {
      return "Stored credentials have expired. Reconnect this server to continue authenticated actions.";
    }

    return "Credentials are expiring soon. Refresh now to avoid interruptions.";
  }, [isTokenExpired]);
  const capabilityCounts = capabilities
    ? {
        tools: capabilities.tools_count,
        resources: capabilities.resources_count,
        prompts: capabilities.prompts_count,
      }
    : { tools: 0, resources: 0, prompts: 0 };
  const isHistoryTab = activeTab === "history";
  const isSettingsTab = activeTab === "settings";
  const isCapabilitiesTab =
    activeTab === "tools" || activeTab === "resources" || activeTab === "prompts";
  const hasCapabilitiesData = capabilities !== null;
  const hasDiscoveredCapabilities = capabilityCounts.tools + capabilityCounts.resources + capabilityCounts.prompts > 0;
  const isCapabilitiesStale = capabilities?.stale === true;
  const isReconnectRequiredStale = capabilities?.stale_reason === "reconnect_required";
  const capabilitiesSurfaceState = useMemo<McpSurfaceState>(() => {
    if (!canInspectCapabilities) {
      return "idle";
    }
    if (isLoadingCapabilities && !hasCapabilitiesData) {
      return "loading";
    }
    if (capabilitiesError && !hasCapabilitiesData) {
      return "error";
    }
    if (!hasCapabilitiesData) {
      return "idle";
    }
    if (isCapabilitiesStale) {
      return "stale";
    }
    if (!hasDiscoveredCapabilities) {
      return "empty";
    }
    return "success";
  }, [
    canInspectCapabilities,
    capabilitiesError,
    hasCapabilitiesData,
    hasDiscoveredCapabilities,
    isCapabilitiesStale,
    isLoadingCapabilities,
  ]);
  const staleCapabilitiesMessage =
    capabilitiesWarning ??
    capabilities?.stale_message ??
    "Showing cached capabilities while we refresh in the background.";

  const loadCapabilities = useCallback(
    async ({
      refresh = false,
      signal,
    }: {
      refresh?: boolean;
      signal?: AbortSignal;
    } = {}): Promise<{ ok: boolean; stale: boolean; message?: string }> => {
      if (!canInspectCapabilities) {
        return { ok: false, stale: false, message: "Server is not connected" };
      }

      setCapabilitiesError(null);
      if (refresh) {
        setRefreshNotice(null);
      }

      if (refresh) {
        setIsRefreshingCapabilities(true);
      } else {
        setCapabilitiesWarning(null);
        setRefreshNotice(null);
        setIsLoadingCapabilities(true);
      }

      try {
        const params = refresh ? "?refresh=1" : "";
        const requestAbortController = new AbortController();
        const timeoutHandle = window.setTimeout(() => {
          requestAbortController.abort();
        }, CAPABILITIES_REQUEST_TIMEOUT_MS);

        const onAbort = () => requestAbortController.abort();
        if (signal) {
          if (signal.aborted) {
            requestAbortController.abort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        const response = await fetch(
          `/api/mcp/${encodeURIComponent(server.id)}/capabilities${params}`,
          {
            method: "GET",
            cache: "no-store",
            signal: requestAbortController.signal,
          },
        ).finally(() => {
          window.clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const normalizedError = normalizeMcpSurfaceError(payload, {
            fallbackCode: "INTERNAL_ERROR",
            fallbackMessage: `Failed to load capabilities (HTTP ${response.status})`,
          });
          throw {
            ...normalizedError,
            source: "server" as const,
            failedAt: new Date().toISOString(),
          } satisfies CapabilitiesSurfaceError;
        }

        const parsedPayload = normalizeCapabilitiesPayload(payload);
        if (signal?.aborted) {
          return { ok: false, stale: false, message: "Request aborted" };
        }

        capabilitiesRef.current = parsedPayload;
        capabilitiesCacheRef.current.set(server.id, parsedPayload);
        setCapabilities(parsedPayload);
        setCapabilitiesError(null);

        const staleMessage = parsedPayload.stale
          ? parsedPayload.stale_message ?? "Showing cached capabilities."
          : null;
        const warningMessage = parsedPayload.error?.message
          ? parsedPayload.error.stale
            ? `Showing cached capabilities. ${parsedPayload.error.message}`
            : parsedPayload.error.message
          : staleMessage;

        setCapabilitiesWarning(warningMessage);

        if (refresh) {
          if (parsedPayload.stale) {
            setRefreshNotice(
              warningMessage ?? "Refresh completed using cached capabilities.",
            );
          } else {
            setRefreshNotice("Capabilities refreshed.");
          }
        }

        onCapabilitiesLoaded?.(server.id, {
          tools: parsedPayload.tools_count,
          resources: parsedPayload.resources_count,
        });
        return {
          ok: true,
          stale: parsedPayload.stale,
          message: warningMessage ?? undefined,
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          if (signal?.aborted) {
            return { ok: false, stale: false, message: "Request aborted" };
          }

          const timeoutError = normalizeCapabilitiesSurfaceError(
            {
              error: {
                code: "NETWORK_ERROR",
                message: `Capabilities request timed out after ${CAPABILITIES_REQUEST_TIMEOUT_MS / 1000}s`,
              },
            },
            {
              fallbackCode: "NETWORK_ERROR",
              fallbackMessage: "Capabilities request timed out",
              source: "network",
            },
          );
          if (capabilitiesRef.current) {
            setCapabilitiesWarning(timeoutError.message);
            if (refresh) {
              setRefreshNotice(timeoutError.message);
            }
          } else {
            capabilitiesRef.current = null;
            setCapabilities(null);
            setCapabilitiesError(timeoutError);
          }
          return {
            ok: false,
            stale: Boolean(capabilitiesRef.current),
            message: timeoutError.message,
          };
        }

        const normalizedError = normalizeCapabilitiesSurfaceError(error, {
          fallbackCode: "NETWORK_ERROR",
          fallbackMessage: "Failed to load capabilities",
          source: "network",
        });
        const message = normalizedError.message;

        if (capabilitiesRef.current) {
          setCapabilitiesWarning(message);
          if (refresh) {
            setRefreshNotice(message);
          }
        } else {
          capabilitiesRef.current = null;
          setCapabilities(null);
          setCapabilitiesError(normalizedError);
        }
        return {
          ok: false,
          stale: Boolean(capabilitiesRef.current),
          message,
        };
      } finally {
        if (!signal?.aborted) {
          if (refresh) {
            setIsRefreshingCapabilities(false);
          } else {
            setIsLoadingCapabilities(false);
          }
        }
      }
    },
    [canInspectCapabilities, onCapabilitiesLoaded, server.id],
  );

  const handleRefreshToken = useCallback(async () => {
    if (isRefreshingToken || server.auth_mode !== "oauth") {
      return;
    }

    setTokenLifecycleNotice(null);
    setIsRefreshingToken(true);

    try {
      const response = await fetch("/api/oauth/refresh", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mcp_server_id: server.id,
          force: true,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | RefreshTokenSuccessPayload
        | {
            error?: {
              message?: string;
            };
          }
        | null;

      if (!response.ok) {
        const errorPayload =
          isRecord(payload) && "error" in payload && isRecord(payload.error) ? payload.error : null;
        const message =
          errorPayload && typeof errorPayload.message === "string"
            ? errorPayload.message
            : `Failed to refresh token (HTTP ${response.status})`;
        throw new Error(message);
      }

      if (!isRefreshTokenSuccessPayload(payload)) {
        throw new Error("Token refresh returned an invalid payload");
      }

      onTokenLifecycleUpdated?.(server.id, {
        connection_status: payload.connection_status,
        connected_at: payload.connected_at,
        token_expires_at: payload.token_expires_at,
        token_lifecycle_state: payload.token_lifecycle_state,
      });

      if (payload.status === "reconnect_required" || payload.connection_status === "expired") {
        setTokenLifecycleNotice({
          type: "error",
          message: "Refresh can no longer recover this session. Reconnect is required.",
        });
        return;
      }

      setTokenLifecycleNotice({
        type: "success",
        message: payload.refreshed
          ? "Token refreshed successfully."
          : "Token is still valid. No refresh was needed.",
      });
    } catch (error) {
      setTokenLifecycleNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to refresh token.",
      });
    } finally {
      setIsRefreshingToken(false);
    }
  }, [isRefreshingToken, onTokenLifecycleUpdated, server.auth_mode, server.id]);

  useEffect(() => {
    setActiveTab("tools");
  }, [server.id]);

  useEffect(() => {
    setCapabilitiesError(null);
    setRefreshNotice(null);
    setTokenLifecycleNotice(null);
    setIsRefreshingToken(false);
    setIsRefreshingCapabilities(false);
    setIsLoadingCapabilities(false);

    if (!canInspectCapabilities) {
      setCapabilitiesWarning(null);
      capabilitiesRef.current = null;
      setCapabilities(null);
      return;
    }

    const cachedCapabilities = capabilitiesCacheRef.current.get(server.id) ?? null;
    capabilitiesRef.current = cachedCapabilities;
    setCapabilities(cachedCapabilities);
    setCapabilitiesWarning(
      cachedCapabilities?.stale
        ? cachedCapabilities.stale_message ?? "Showing cached capabilities."
        : null,
    );

    const abortController = new AbortController();
    void loadCapabilities({ signal: abortController.signal });

    return () => abortController.abort();
  }, [canInspectCapabilities, loadCapabilities, server.id]);

  return (
    <div className="flex h-full min-h-0 flex-col p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
          <Image
            src={server.icon_url}
            alt={`${server.name} icon`}
            width={28}
            height={28}
            className="rounded-md border bg-background p-1"
          />
          <p className="truncate text-sm font-semibold sm:text-base">{server.name}</p>
          <Badge className={status.className}>{status.label}</Badge>
          {isServerDisabled ? <Badge variant="outline">Disabled</Badge> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isConnected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onDisconnect?.(server.id)}
              disabled={isBusy || isServerDisabled}
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                "Disconnect"
              )}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => onConnect?.(server.id)}
              disabled={isBusy || isServerDisabled}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Redirecting...
                </>
              ) : server.connection_status === "expired" ? (
                "Reconnect"
              ) : (
                "Connect"
              )}
            </Button>
          )}
        </div>
      </div>

      {isServerDisabled ? (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-muted-foreground/30 bg-muted/40 p-3 text-xs text-muted-foreground"
          role="status"
        >
          <p>This server is disabled. Enable it in settings to reconnect and run MCP actions.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setActiveTab("settings")}
          >
            Open settings
          </Button>
        </div>
      ) : null}

      {showTokenLifecycleWarning ? (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900"
          role="status"
        >
          <p>{tokenLifecycleBannerMessage}</p>
          <div className="flex items-center gap-2">
            {isTokenExpired ? (
              <Button
                type="button"
                size="sm"
                onClick={() => onConnect?.(server.id)}
                disabled={isBusy || !onConnect}
              >
                Reconnect now
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleRefreshToken()}
                disabled={isBusy}
              >
                {isRefreshingToken ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Refreshing token...
                  </>
                ) : (
                  "Refresh token"
                )}
              </Button>
            )}
          </div>
        </div>
      ) : null}
      {tokenLifecycleNotice ? (
        <div
          className={`mt-3 rounded-md border p-3 text-xs ${
            tokenLifecycleNotice.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
          role="status"
        >
          {tokenLifecycleNotice.message}
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as CapabilitiesTab)}
        className="mt-3 flex min-h-0 flex-1 flex-col"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="w-full sm:w-auto" aria-label="Server sections">
            <TabsTrigger value="tools" disabled={!canInspectCapabilities}>
              Tools
              <Badge variant="secondary">{capabilityCounts.tools}</Badge>
            </TabsTrigger>
            <TabsTrigger value="resources" disabled={!canInspectCapabilities}>
              Resources
              <Badge variant="secondary">{capabilityCounts.resources}</Badge>
            </TabsTrigger>
            <TabsTrigger value="prompts" disabled={!canInspectCapabilities}>
              Prompts
              <Badge variant="secondary">{capabilityCounts.prompts}</Badge>
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {isCapabilitiesTab ? (
              <Badge variant="outline" className="h-8 px-2 text-[11px]">
                {SURFACE_STATE_LABELS[capabilitiesSurfaceState]}
              </Badge>
            ) : null}
            {isCapabilitiesTab ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void loadCapabilities({ refresh: true })}
                disabled={!canManualRefreshCapabilities || isRefreshingCapabilities || isBusy}
              >
                {isRefreshingCapabilities ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Refreshing...
                  </>
                ) : (
                  "Refresh"
                )}
              </Button>
            ) : null}
          </div>
        </div>
        <div
          className="mt-3 min-h-0 flex-1 rounded-lg border bg-muted/20 p-3"
          data-surface-state={
            isHistoryTab ? "history" : isSettingsTab ? "settings" : capabilitiesSurfaceState
          }
        >
          {isSettingsTab ? (
            <TabsContent value="settings" className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1">
              <ServerSettingsWorkspace server={server} onServerUpdated={onServerUpdated} />
            </TabsContent>
          ) : isHistoryTab ? (
            <TabsContent value="history" className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1">
              <ExecutionHistoryWorkspace
                serverId={server.id}
                serverName={server.name}
                onReconnect={onConnect ? () => onConnect(server.id) : undefined}
                onRefreshCapabilities={() => void loadCapabilities({ refresh: true })}
              />
            </TabsContent>
          ) : !canInspectCapabilities ? (
            isServerDisabled ? (
              <DisabledCapabilitiesState onOpenSettings={() => setActiveTab("settings")} />
            ) : (
              <DisconnectedCapabilitiesState />
            )
          ) : capabilitiesSurfaceState === "error" ? (
            <CapabilitiesErrorState
              error={capabilitiesError}
              onRetry={() => void loadCapabilities()}
              onReconnect={
                onConnect ? () => onConnect(server.id) : undefined
              }
              onRefreshCapabilities={() => void loadCapabilities({ refresh: true })}
              isRetrying={isLoadingCapabilities}
            />
          ) : capabilitiesSurfaceState === "loading" ? (
            <CapabilitiesLoadingState />
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3">
              {isLoadingCapabilities && hasCapabilitiesData ? (
                <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-900" role="status">
                  Updating capabilities in the background...
                </div>
              ) : null}
              {capabilitiesSurfaceState === "stale" ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900"
                  role="status"
                >
                  <p>{staleCapabilitiesMessage}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => {
                      if (isReconnectRequiredStale) {
                        onConnect?.(server.id);
                        return;
                      }
                      void loadCapabilities({ refresh: true });
                    }}
                    disabled={
                      isRefreshingCapabilities || isBusy || (isReconnectRequiredStale && !onConnect)
                    }
                  >
                    {isRefreshingCapabilities ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Refreshing...
                      </>
                    ) : isReconnectRequiredStale ? (
                      "Reconnect"
                    ) : (
                      "Retry"
                    )}
                  </Button>
                </div>
              ) : null}
              {capabilitiesWarning && capabilitiesSurfaceState !== "stale" ? (
                <div
                  className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
                  role="status"
                >
                  {capabilitiesWarning}
                </div>
              ) : null}
              {refreshNotice && capabilitiesSurfaceState !== "stale" ? (
                <div
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900"
                  role="status"
                >
                  {refreshNotice}
                </div>
              ) : null}
              <TabsContent value="tools" className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
                {capabilities && capabilities.tools.length > 0 ? (
                  <ToolExecutionWorkspace
                    serverId={server.id}
                    serverName={server.name}
                    tools={capabilities.tools}
                    onReconnect={onConnect ? () => onConnect(server.id) : undefined}
                    onRefreshCapabilities={() => void loadCapabilities({ refresh: true })}
                  />
                ) : (
                  <CapabilitiesEmptyState
                    message="No tools discovered yet. Refresh capabilities or reconnect to resync this server."
                  />
                )}
              </TabsContent>
              <TabsContent
                value="resources"
                className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1"
              >
                {capabilities && capabilities.resources.length > 0 ? (
                  <ResourceReadingWorkspace
                    serverId={server.id}
                    serverName={server.name}
                    resources={capabilities.resources}
                    onReconnect={onConnect ? () => onConnect(server.id) : undefined}
                    onRefreshCapabilities={() => void loadCapabilities({ refresh: true })}
                  />
                ) : (
                  <CapabilitiesEmptyState
                    message="No resources discovered yet. Refresh capabilities to check for newly published resources."
                  />
                )}
              </TabsContent>
              <TabsContent value="prompts" className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1">
                {capabilities && capabilities.prompts.length > 0 ? (
                  <ul className="space-y-2">
                    {capabilities.prompts.map((prompt, index) => (
                      <PromptCapabilityRow key={`${prompt.name}-${index}`} prompt={prompt} />
                    ))}
                  </ul>
                ) : (
                  <CapabilitiesEmptyState
                    message="No prompts discovered yet. Refresh capabilities to sync prompt definitions."
                  />
                )}
              </TabsContent>
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}

function DisconnectedCapabilitiesState() {
  return (
    <div className="flex h-full items-center justify-center rounded-md bg-muted/10 px-6 text-center">
      <p className="text-sm text-muted-foreground">
        Connect this server to discover tools, resources, and prompts.
      </p>
    </div>
  );
}

function DisabledCapabilitiesState({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex h-full items-center justify-center rounded-md bg-muted/10 px-6 text-center">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This server is currently disabled. Enable it in settings to continue.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onOpenSettings}>
          Open settings
        </Button>
      </div>
    </div>
  );
}

function CapabilitiesEmptyState({ message }: { message: string }) {
  return <CapabilityEmptyState message={message} />;
}

function CapabilitiesLoadingState() {
  return (
    <LoadingSection label="Loading capabilities">
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonCard key={index} lineWidths={["h-4 w-40", "w-full", "w-3/4"]} />
      ))}
    </LoadingSection>
  );
}

function CapabilitiesErrorState({
  error,
  onRetry,
  onReconnect,
  onRefreshCapabilities,
  isRetrying,
}: {
  error: CapabilitiesSurfaceError | null;
  onRetry: () => void;
  onReconnect?: () => void;
  onRefreshCapabilities?: () => void;
  isRetrying: boolean;
}) {
  const resolvedError =
    error ??
    normalizeCapabilitiesSurfaceError(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to load capabilities.",
        },
      },
      {
        fallbackCode: "INTERNAL_ERROR",
        fallbackMessage: "Failed to load capabilities.",
        source: "client",
      },
    );
  const remediation = resolveMcpSurfaceErrorAction(resolvedError, {
    retry: onRetry,
    reconnect: onReconnect,
    refreshCapabilities: onRefreshCapabilities,
    checkEndpoint: onRetry,
  });
  const diagnostics = buildMcpSurfaceErrorDiagnostics(resolvedError, {
    source: resolvedError.source,
    failed_at: resolvedError.failedAt,
    context: "capabilities",
  });

  return (
    <div className="flex h-full items-center justify-center rounded-md bg-destructive/5 px-6" role="alert">
      <div className="max-w-xl space-y-3 text-center">
        <p className="text-sm text-destructive">Failed to load capabilities: {resolvedError.message}</p>
        {resolvedError.details.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-left text-xs text-destructive">
            {resolvedError.details.map((detail, index) => (
              <li key={`${detail}-${index}`}>{detail}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-destructive">{remediation.hint}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {remediation.onClick ? (
            <Button type="button" variant="outline" onClick={remediation.onClick} disabled={isRetrying}>
              {isRetrying ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Retrying...
                </>
              ) : (
                remediation.label
              )}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(diagnostics)}
          >
            Copy Diagnostics
          </Button>
        </div>
        {remediation.action !== "retry" ? (
          <Button type="button" variant="ghost" onClick={onRetry} disabled={isRetrying}>
            Retry fetch
          </Button>
        ) : null}
        <details className="rounded border bg-background p-2 text-left text-[11px] text-muted-foreground">
          <summary className="cursor-pointer text-xs font-medium">Diagnostics</summary>
          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-foreground">
            {diagnostics}
          </pre>
        </details>
      </div>
    </div>
  );
}

function isTokenLifecycleState(value: unknown): value is TokenLifecycleState {
  return (
    value === "healthy" ||
    value === "expiring_soon" ||
    value === "expired" ||
    value === "unknown"
  );
}

function isRefreshTokenSuccessPayload(payload: unknown): payload is RefreshTokenSuccessPayload {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    typeof payload.mcp_server_id === "string" &&
    (payload.status === "connected" || payload.status === "reconnect_required") &&
    (payload.connection_status === "connected" || payload.connection_status === "expired") &&
    (payload.connected_at === null || typeof payload.connected_at === "string") &&
    (payload.token_expires_at === null || typeof payload.token_expires_at === "string") &&
    isTokenLifecycleState(payload.token_lifecycle_state)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCount(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }

  return fallback;
}

function normalizeNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  return null;
}

function isCapabilitiesSurfaceError(value: unknown): value is CapabilitiesSurfaceError {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.message === "string" &&
    typeof value.code === "string" &&
    typeof value.category === "string" &&
    Array.isArray(value.details) &&
    typeof value.source === "string" &&
    typeof value.failedAt === "string"
  );
}

function normalizeCapabilitiesSurfaceError(
  error: unknown,
  options: {
    fallbackCode: McpInteractionErrorCode;
    fallbackMessage: string;
    source: CapabilitiesSurfaceError["source"];
  },
): CapabilitiesSurfaceError {
  if (isCapabilitiesSurfaceError(error)) {
    return error;
  }

  const normalized = normalizeMcpSurfaceError(error, {
    fallbackCode: options.fallbackCode,
    fallbackMessage: options.fallbackMessage,
  });

  return {
    ...normalized,
    source: options.source,
    failedAt: new Date().toISOString(),
  };
}

function normalizeCapabilitiesPayload(payload: unknown): CapabilitiesApiPayload {
  if (!isRecord(payload)) {
    throw new Error("Invalid capabilities payload");
  }

  const tools = Array.isArray(payload.tools)
    ? payload.tools.map((tool, index) => normalizeTool(tool, index))
    : [];
  const resources = Array.isArray(payload.resources)
    ? payload.resources.map((resource, index) => normalizeResource(resource, index))
    : [];
  const prompts = Array.isArray(payload.prompts)
    ? payload.prompts.map((prompt, index) => normalizePrompt(prompt, index))
    : [];

  const response: CapabilitiesApiPayload = {
    mcp_server_id:
      normalizeOptionalString(payload.mcp_server_id) ??
      "unknown-mcp-server",
    tools,
    resources,
    prompts,
    tools_count: normalizeCount(payload.tools_count, tools.length),
    resources_count: normalizeCount(payload.resources_count, resources.length),
    prompts_count: normalizeCount(payload.prompts_count, prompts.length),
    cached: payload.cached === true,
    last_discovered_at: normalizeOptionalString(payload.last_discovered_at) ?? "",
    stale: payload.stale === true,
    stale_reason: normalizeOptionalString(payload.stale_reason),
    stale_message: normalizeOptionalString(payload.stale_message),
    cache_age_ms: normalizeNullableNumber(payload.cache_age_ms),
    cache_ttl_ms: normalizeNullableNumber(payload.cache_ttl_ms),
    background_refresh_scheduled: payload.background_refresh_scheduled === true,
  };

  if (isRecord(payload.error)) {
    const message = normalizeOptionalString(payload.error.message);
    if (message) {
      response.error = {
        code: normalizeOptionalString(payload.error.code) ?? "CAPABILITY_LOAD_FAILED",
        category: normalizeOptionalString(payload.error.category) ?? undefined,
        message,
        details: Array.isArray(payload.error.details)
          ? payload.error.details
              .map((item) => normalizeOptionalString(item))
              .filter((item): item is string => Boolean(item))
          : undefined,
        stale: payload.error.stale === true,
      };
    }
  }

  return response;
}

function normalizeTool(tool: unknown, index: number): ToolCapability {
  if (!isRecord(tool)) {
    return {
      name: `tool_${index + 1}`,
      description: null,
      inputSchema: {},
    };
  }

  return {
    name: normalizeOptionalString(tool.name) ?? `tool_${index + 1}`,
    description: normalizeOptionalString(tool.description),
    inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : {},
  };
}

function normalizeResource(resource: unknown, index: number): ResourceCapability {
  if (!isRecord(resource)) {
    return {
      uri: `resource://${index + 1}`,
      name: `Resource ${index + 1}`,
      description: null,
      mimeType: null,
    };
  }

  return {
    uri: normalizeOptionalString(resource.uri) ?? `resource://${index + 1}`,
    name: normalizeOptionalString(resource.name) ?? `Resource ${index + 1}`,
    description: normalizeOptionalString(resource.description),
    mimeType: normalizeOptionalString(resource.mimeType),
  };
}

function normalizePrompt(prompt: unknown, index: number): PromptCapability {
  if (!isRecord(prompt)) {
    return {
      name: `prompt_${index + 1}`,
      description: null,
      arguments: [],
    };
  }

  const normalizedArguments = Array.isArray(prompt.arguments)
    ? prompt.arguments
        .map((argument, argumentIndex) => normalizePromptArgument(argument, argumentIndex))
        .filter((argument): argument is PromptCapability["arguments"][number] => Boolean(argument))
    : [];

  return {
    name: normalizeOptionalString(prompt.name) ?? `prompt_${index + 1}`,
    description: normalizeOptionalString(prompt.description),
    arguments: normalizedArguments,
  };
}

function normalizePromptArgument(argument: unknown, index: number) {
  if (!isRecord(argument)) {
    return null;
  }

  return {
    name: normalizeOptionalString(argument.name) ?? `arg_${index + 1}`,
    description: normalizeOptionalString(argument.description),
    required: argument.required === true,
  };
}
