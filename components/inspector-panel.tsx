"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";

import {
  CapabilityEmptyState,
  PromptCapabilityRow,
  ResourceCapabilityRow,
  ToolCapabilityRow,
  type PromptCapability,
  type ResourceCapability,
  type ToolCapability,
} from "@/components/capability-list-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConnectionStatus, McpServer } from "@/lib/types";
import { cn } from "@/lib/utils";

type InspectorPanelProps = {
  isExpanded: boolean;
  selectedServer: McpServer | null;
  onClearSelection: () => void;
  onExpandedChange: (expanded: boolean) => void;
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
  error?: CapabilitiesApiError;
};

type CapabilitiesTab = "tools" | "resources" | "prompts";

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

export function InspectorPanel({
  isExpanded,
  selectedServer,
  onClearSelection,
  onExpandedChange,
  onConnect,
  onDisconnect,
  onCapabilitiesLoaded,
  isConnecting = false,
  isDisconnecting = false,
}: InspectorPanelProps) {
  return (
    <aside
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 shadow-[0_-10px_30px_-24px_rgba(0,0,0,0.6)] backdrop-blur supports-[backdrop-filter]:bg-background/80",
        "transition-[height] duration-300 ease-out",
        isExpanded ? "h-[40vh] min-h-64 max-h-[520px]" : "h-10",
      )}
      aria-label="Inspector panel"
    >
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => onExpandedChange(!isExpanded)}
          className="flex h-10 w-full items-center justify-between text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={isExpanded}
          aria-controls="inspector-content"
        >
          <span>Inspector</span>
          {isExpanded ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronUp className="size-4" aria-hidden="true" />
          )}
        </button>

        <div
          id="inspector-content"
          className={cn(
            "min-h-0 flex-1 overflow-hidden border-t transition-opacity duration-200",
            isExpanded ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {selectedServer ? (
            <SelectedServerContent
              server={selectedServer}
              onClearSelection={onClearSelection}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onCapabilitiesLoaded={onCapabilitiesLoaded}
              isConnecting={isConnecting}
              isDisconnecting={isDisconnecting}
            />
          ) : (
            <EmptyInspectorState />
          )}
        </div>
      </div>
    </aside>
  );
}

function SelectedServerContent({
  server,
  onClearSelection,
  onConnect,
  onDisconnect,
  onCapabilitiesLoaded,
  isConnecting,
  isDisconnecting,
}: {
  server: McpServer;
  onClearSelection: () => void;
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
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(false);
  const [isRefreshingCapabilities, setIsRefreshingCapabilities] = useState(false);
  const capabilitiesRef = useRef<CapabilitiesApiPayload | null>(null);

  const status = STATUS_STYLES[server.connection_status];
  const isConnected = server.connection_status === "connected";
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
    } = {}) => {
      if (!isConnected) {
        return;
      }

      setCapabilitiesError(null);
      setCapabilitiesWarning(null);

      if (refresh) {
        setIsRefreshingCapabilities(true);
      } else {
        setIsLoadingCapabilities(true);
      }

      try {
        const params = refresh ? "?refresh=1" : "";
        const response = await fetch(
          `/api/mcp/${encodeURIComponent(server.id)}/capabilities${params}`,
          {
            method: "GET",
            cache: "no-store",
            signal,
          },
        );

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            readErrorMessage(payload) ??
            `Failed to load capabilities (HTTP ${response.status})`;
          throw new Error(message);
        }

        const parsedPayload = normalizeCapabilitiesPayload(payload);
        if (signal?.aborted) {
          return;
        }

        capabilitiesRef.current = parsedPayload;
        setCapabilities(parsedPayload);
        setCapabilitiesError(null);

        const warningMessage = parsedPayload.error?.message
          ? parsedPayload.error.stale
            ? `Showing cached capabilities. ${parsedPayload.error.message}`
            : parsedPayload.error.message
          : null;
        setCapabilitiesWarning(warningMessage);

        onCapabilitiesLoaded?.(server.id, {
          tools: parsedPayload.tools_count,
          resources: parsedPayload.resources_count,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Failed to load capabilities";

        if (refresh && capabilitiesRef.current) {
          setCapabilitiesWarning(message);
        } else {
          capabilitiesRef.current = null;
          setCapabilities(null);
          setCapabilitiesError(message);
        }
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
    [isConnected, onCapabilitiesLoaded, server.id],
  );

  useEffect(() => {
    setActiveTab("tools");
  }, [server.id]);

  useEffect(() => {
    setCapabilitiesError(null);
    setCapabilitiesWarning(null);
    setIsLoadingCapabilities(false);
    setIsRefreshingCapabilities(false);
    capabilitiesRef.current = null;
    setCapabilities(null);

    if (!isConnected) {
      return;
    }

    const abortController = new AbortController();
    void loadCapabilities({ signal: abortController.signal });

    return () => abortController.abort();
  }, [isConnected, loadCapabilities, server.id]);

  return (
    <div className="flex h-full min-h-0 flex-col py-3">
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClearSelection}
            aria-label="Clear selected server"
            className="size-8"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as CapabilitiesTab)}
        className="mt-3 flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="tools" disabled={!isConnected}>
            Tools
            <Badge variant="secondary">{capabilityCounts.tools}</Badge>
          </TabsTrigger>
          <TabsTrigger value="resources" disabled={!isConnected}>
            Resources
            <Badge variant="secondary">{capabilityCounts.resources}</Badge>
          </TabsTrigger>
          <TabsTrigger value="prompts" disabled={!isConnected}>
            Prompts
            <Badge variant="secondary">{capabilityCounts.prompts}</Badge>
          </TabsTrigger>
        </TabsList>
        <div className="mt-3 min-h-0 flex-1 rounded-lg border bg-muted/20 p-3">
          {!isConnected ? (
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
              <TabsContent value="tools" className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1">
                {capabilities && capabilities.tools.length > 0 ? (
                  <ul className="space-y-2">
                    {capabilities.tools.map((tool, index) => (
                      <ToolCapabilityRow key={`${tool.name}-${index}`} tool={tool} />
                    ))}
                  </ul>
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

function EmptyInspectorState() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center text-muted-foreground">
        <Search className="size-8" aria-hidden="true" />
        <p className="text-sm sm:text-base">
          Select a server to inspect its tools and resources
        </p>
      </div>
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
    <div className="flex h-full items-center justify-center rounded-md bg-destructive/5 px-6">
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
