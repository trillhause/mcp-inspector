"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";

import {
  CapabilityEmptyState,
  PromptCapabilityRow,
  ResourceCapabilityRow,
  type PromptCapability,
  type ResourceCapability,
  type ToolCapability,
} from "@/components/capability-list-rows";
import { ToolExecutionWorkspace } from "@/components/tool-execution-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConnectionStatus, McpServer } from "@/lib/types";

type ServerDetailsPanelProps = {
  selectedServer: McpServer;
  onConnect?: (serverId: string) => void;
  onDisconnect?: (serverId: string) => void;
  onCapabilitiesLoaded?: (
    serverId: string,
    counts: { tools: number; resources: number },
  ) => void;
  isConnecting?: boolean;
  isDisconnecting?: boolean;
};

type CapabilitiesApiError = {
  code: string;
  message: string;
  details?: string[];
  stale?: boolean;
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

type CapabilitiesTab = "tools" | "resources" | "prompts";
const CAPABILITIES_REQUEST_TIMEOUT_MS = 20_000;

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
  onCapabilitiesLoaded,
  isConnecting = false,
  isDisconnecting = false,
}: ServerDetailsPanelProps) {
  return (
    <div className="flex h-full flex-col" aria-label="Server details">
      <SelectedServerContent
        server={selectedServer}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onCapabilitiesLoaded={onCapabilitiesLoaded}
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
  onCapabilitiesLoaded,
  isConnecting,
  isDisconnecting,
}: {
  server: McpServer;
  onConnect?: (serverId: string) => void;
  onDisconnect?: (serverId: string) => void;
  onCapabilitiesLoaded?: (
    serverId: string,
    counts: { tools: number; resources: number },
  ) => void;
  isConnecting: boolean;
  isDisconnecting: boolean;
}) {
  const [activeTab, setActiveTab] = useState<CapabilitiesTab>("tools");
  const [capabilities, setCapabilities] = useState<CapabilitiesApiPayload | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [capabilitiesWarning, setCapabilitiesWarning] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(false);
  const [isRefreshingCapabilities, setIsRefreshingCapabilities] = useState(false);
  const capabilitiesRef = useRef<CapabilitiesApiPayload | null>(null);

  const status = STATUS_STYLES[server.connection_status];
  const isConnected = server.connection_status === "connected";
  const canInspectCapabilities = server.connection_status !== "disconnected";
  const isBusy = isConnecting || isDisconnecting;
  const capabilityCounts = capabilities
    ? {
        tools: capabilities.tools_count,
        resources: capabilities.resources_count,
        prompts: capabilities.prompts_count,
      }
    : { tools: 0, resources: 0, prompts: 0 };

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
          const message =
            readErrorMessage(payload) ??
            `Failed to load capabilities (HTTP ${response.status})`;
          throw new Error(message);
        }

        const parsedPayload = normalizeCapabilitiesPayload(payload);
        if (signal?.aborted) {
          return { ok: false, stale: false, message: "Request aborted" };
        }

        capabilitiesRef.current = parsedPayload;
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
          const message = signal?.aborted
            ? "Request aborted"
            : `Capabilities request timed out after ${CAPABILITIES_REQUEST_TIMEOUT_MS / 1000}s`;
          return { ok: false, stale: false, message };
        }

        const message =
          error instanceof Error ? error.message : "Failed to load capabilities";

        if (refresh && capabilitiesRef.current) {
          setCapabilitiesWarning(message);
          setRefreshNotice(message);
        } else {
          capabilitiesRef.current = null;
          setCapabilities(null);
          setCapabilitiesError(message);
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

  useEffect(() => {
    setActiveTab("tools");
  }, [server.id]);

  useEffect(() => {
    setCapabilitiesError(null);
    setCapabilitiesWarning(null);
    setRefreshNotice(null);
    setIsLoadingCapabilities(false);
    setIsRefreshingCapabilities(false);
    capabilitiesRef.current = null;
    setCapabilities(null);

    if (!canInspectCapabilities) {
      return;
    }

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
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isConnected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onDisconnect?.(server.id)}
              disabled={isBusy}
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
              disabled={isBusy}
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

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as CapabilitiesTab)}
        className="mt-3 flex min-h-0 flex-1 flex-col"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="w-full sm:w-auto" aria-label="Server capabilities">
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
          </TabsList>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void loadCapabilities({ refresh: true })}
            disabled={!canInspectCapabilities || isRefreshingCapabilities}
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
        </div>
        <div className="mt-3 min-h-0 flex-1 rounded-lg border bg-muted/20 p-3">
          {!canInspectCapabilities ? (
            <DisconnectedCapabilitiesState />
          ) : capabilitiesError ? (
            <CapabilitiesErrorState
              error={capabilitiesError}
              onRetry={() => void loadCapabilities()}
              isRetrying={isLoadingCapabilities}
            />
          ) : isLoadingCapabilities && !capabilities ? (
            <CapabilitiesLoadingState />
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3">
              {capabilitiesWarning ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900"
                  role="status"
                >
                  <p>{capabilitiesWarning}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => void loadCapabilities({ refresh: true })}
                    disabled={isRefreshingCapabilities}
                  >
                    {isRefreshingCapabilities ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Refreshing...
                      </>
                    ) : (
                      "Retry"
                    )}
                  </Button>
                </div>
              ) : null}
              {refreshNotice && !capabilitiesWarning ? (
                <div
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900"
                  role="status"
                >
                  {refreshNotice}
                </div>
              ) : null}
              <TabsContent value="tools" className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1">
                {capabilities && capabilities.tools.length > 0 ? (
                  <ToolExecutionWorkspace
                    serverId={server.id}
                    tools={capabilities.tools}
                  />
                ) : (
                  <CapabilityEmptyState message="No tools discovered for this server." />
                )}
              </TabsContent>
              <TabsContent
                value="resources"
                className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1"
              >
                {capabilities && capabilities.resources.length > 0 ? (
                  <ul className="space-y-2">
                    {capabilities.resources.map((resource, index) => (
                      <ResourceCapabilityRow
                        key={`${resource.uri}-${index}`}
                        resource={resource}
                      />
                    ))}
                  </ul>
                ) : (
                  <CapabilityEmptyState message="No resources discovered for this server." />
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
                  <CapabilityEmptyState message="No prompts discovered for this server." />
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

function CapabilitiesLoadingState() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-background p-3">
          <div className="flex animate-pulse flex-col gap-2">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-3/4 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CapabilitiesErrorState({
  error,
  onRetry,
  isRetrying,
}: {
  error: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center rounded-md bg-destructive/5 px-6" role="alert">
      <div className="max-w-xl space-y-3 text-center">
        <p className="text-sm text-destructive">Failed to load capabilities: {error}</p>
        <Button type="button" variant="outline" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Retrying...
            </>
          ) : (
            "Retry"
          )}
        </Button>
      </div>
    </div>
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

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  return normalizeOptionalString(payload.error.message);
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
