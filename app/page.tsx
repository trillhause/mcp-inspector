"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AddServerDialog } from "@/components/add-server-dialog";
import { Header } from "@/components/header";
import { InspectorPanel } from "@/components/inspector-panel";
import { ServerGrid } from "@/components/server-grid";
import { Button } from "@/components/ui/button";
import type { McpServer } from "@/lib/types";

const OAUTH_QUERY_PARAMS = [
  "oauth_status",
  "mcp_server_id",
  "oauth_error_code",
  "oauth_error_message",
] as const;

type OAuthNotice = {
  type: "success" | "error";
  message: string;
};

function sortServers(serverList: McpServer[]) {
  return [...serverList].sort((a, b) => {
    if (a.is_preconfigured !== b.is_preconfigured) {
      return a.is_preconfigured ? -1 : 1;
    }

    const nameSort = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (nameSort !== 0) {
      return nameSort;
    }

    return a.id.localeCompare(b.id);
  });
}

export default function Home() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [isLoadingServers, setIsLoadingServers] = useState(true);
  const [serversError, setServersError] = useState<string | null>(null);
  const [oauthNotice, setOauthNotice] = useState<OAuthNotice | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(false);
  const [isAddServerDialogOpen, setIsAddServerDialogOpen] = useState(false);
  const [deletingServerIds, setDeletingServerIds] = useState<Set<string>>(new Set());
  const [connectingServerIds, setConnectingServerIds] = useState<Set<string>>(new Set());
  const [disconnectingServerIds, setDisconnectingServerIds] = useState<Set<string>>(new Set());

  const loadServers = useCallback(async (signal?: AbortSignal) => {
    setServersError(null);
    setIsLoadingServers(true);

    try {
      const response = await fetch("/api/servers", {
        method: "GET",
        cache: "no-store",
        signal,
      });

      const payload = (await response.json()) as {
        servers?: McpServer[];
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Failed to load servers");
      }

      if (!Array.isArray(payload.servers)) {
        throw new Error("Invalid server response payload");
      }

      setServers(sortServers(payload.servers));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setServersError(error instanceof Error ? error.message : "Failed to load servers");
    } finally {
      if (!signal?.aborted) {
        setIsLoadingServers(false);
      }
    }
  }, []);

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) ?? null,
    [selectedServerId, servers],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedServerId(null);
      setIsInspectorExpanded(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    void loadServers(abortController.signal);

    return () => abortController.abort();
  }, [loadServers]);

  useEffect(() => {
    if (!selectedServerId) return;

    const serverStillExists = servers.some((server) => server.id === selectedServerId);
    if (serverStillExists) return;

    setSelectedServerId(null);
    setIsInspectorExpanded(false);
  }, [selectedServerId, servers]);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const oauthStatus = currentUrl.searchParams.get("oauth_status");
    if (!oauthStatus) {
      return;
    }

    const mcpServerId = currentUrl.searchParams.get("mcp_server_id");
    const oauthErrorCode = currentUrl.searchParams.get("oauth_error_code");
    const oauthErrorMessage = currentUrl.searchParams.get("oauth_error_message");

    for (const key of OAUTH_QUERY_PARAMS) {
      currentUrl.searchParams.delete(key);
    }

    const nextPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    window.history.replaceState({}, "", nextPath);

    const reconcileAfterCallback = async () => {
      await loadServers();

      if (mcpServerId) {
        setSelectedServerId(mcpServerId);
        setIsInspectorExpanded(true);
      }

      if (oauthStatus === "success") {
        setServersError(null);
        setOauthNotice({
          type: "success",
          message: "OAuth connection completed successfully.",
        });
        return;
      }

      const codePrefix = oauthErrorCode ? `[${oauthErrorCode}] ` : "";
      setOauthNotice({
        type: "error",
        message:
          `${codePrefix}${oauthErrorMessage ?? "OAuth callback failed. Start a new connect flow."}`,
      });
    };

    void reconcileAfterCallback();
  }, [loadServers]);

  const handleSelectServer = (serverId: string) => {
    setSelectedServerId(serverId);
    setIsInspectorExpanded(true);
  };

  const handleServerCreated = useCallback((server: McpServer) => {
    setServers((previousServers) =>
      sortServers([
        ...previousServers.filter((item) => item.id !== server.id),
        server,
      ]),
    );
    setSelectedServerId(server.id);
    setIsInspectorExpanded(true);
    setServersError(null);
  }, []);

  const handleConnectServer = useCallback(
    async (serverId: string) => {
      if (connectingServerIds.has(serverId) || disconnectingServerIds.has(serverId)) {
        return;
      }

      setServersError(null);
      setOauthNotice(null);
      setConnectingServerIds((previousIds) => {
        const nextIds = new Set(previousIds);
        nextIds.add(serverId);
        return nextIds;
      });

      try {
        const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/connect`, {
          method: "POST",
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              authorization_url?: string;
              error?: { message?: string };
            }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Failed to initiate OAuth connect flow");
        }

        if (!payload?.authorization_url) {
          throw new Error("Connect response did not include an authorization URL");
        }

        window.location.assign(payload.authorization_url);
      } catch (error) {
        setServersError(
          error instanceof Error ? error.message : "Failed to initiate OAuth connect flow",
        );
      } finally {
        setConnectingServerIds((previousIds) => {
          const nextIds = new Set(previousIds);
          nextIds.delete(serverId);
          return nextIds;
        });
      }
    },
    [connectingServerIds, disconnectingServerIds],
  );

  const handleDisconnectServer = useCallback(
    async (serverId: string) => {
      if (disconnectingServerIds.has(serverId) || connectingServerIds.has(serverId)) {
        return;
      }

      const previousServer = servers.find((server) => server.id === serverId);
      if (!previousServer) {
        return;
      }

      setServersError(null);
      setOauthNotice(null);
      setDisconnectingServerIds((previousIds) => {
        const nextIds = new Set(previousIds);
        nextIds.add(serverId);
        return nextIds;
      });

      setServers((previousServers) =>
        previousServers.map((server) =>
          server.id === serverId
            ? {
                ...server,
                connection_status: "disconnected",
                connected_at: null,
              }
            : server,
        ),
      );

      try {
        const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/disconnect`, {
          method: "POST",
        });

        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;

        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Failed to disconnect server");
        }

        await loadServers();
      } catch (error) {
        setServers((previousServers) =>
          previousServers.map((server) => (server.id === previousServer.id ? previousServer : server)),
        );
        setServersError(error instanceof Error ? error.message : "Failed to disconnect server");
      } finally {
        setDisconnectingServerIds((previousIds) => {
          const nextIds = new Set(previousIds);
          nextIds.delete(serverId);
          return nextIds;
        });
      }
    },
    [connectingServerIds, disconnectingServerIds, loadServers, servers],
  );

  const handleDeleteServer = useCallback(
    async (serverId: string) => {
      const server = servers.find((item) => item.id === serverId);
      if (!server || server.is_preconfigured) {
        return;
      }

      const shouldDelete = window.confirm(`Delete "${server.name}"?`);
      if (!shouldDelete) {
        return;
      }

      setServersError(null);
      setDeletingServerIds((previousIds) => {
        const nextIds = new Set(previousIds);
        nextIds.add(serverId);
        return nextIds;
      });

      try {
        const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}`, {
          method: "DELETE",
        });

        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;

        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Failed to delete server");
        }

        setServers((previousServers) =>
          previousServers.filter((item) => item.id !== serverId),
        );
      } catch (error) {
        setServersError(
          error instanceof Error ? error.message : "Failed to delete server",
        );
      } finally {
        setDeletingServerIds((previousIds) => {
          const nextIds = new Set(previousIds);
          nextIds.delete(serverId);
          return nextIds;
        });
      }
    },
    [servers],
  );

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background">
      <Header onAddServer={() => setIsAddServerDialogOpen(true)} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-20 sm:px-6 lg:px-8">
        <div className="space-y-4">
          {oauthNotice ? (
            <div
              className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${
                oauthNotice.type === "success"
                  ? "border-emerald-400/40 bg-emerald-500/5"
                  : "border-destructive/40 bg-destructive/5"
              }`}
              role={oauthNotice.type === "error" ? "alert" : "status"}
            >
              <p
                className={`text-sm ${
                  oauthNotice.type === "success" ? "text-emerald-700" : "text-destructive"
                }`}
              >
                {oauthNotice.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOauthNotice(null)}
              >
                Dismiss
              </Button>
            </div>
          ) : null}
          {serversError ? (
            <div
              className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
              role="alert"
            >
              <p className="text-sm text-destructive">Error: {serversError}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadServers()}
                disabled={isLoadingServers}
              >
                Retry
              </Button>
            </div>
          ) : null}
          <ServerGrid
            servers={servers}
            isLoading={isLoadingServers}
            selectedServerId={selectedServerId}
            onSelectServer={handleSelectServer}
            onDeleteServer={(serverId) => void handleDeleteServer(serverId)}
            deletingServerIds={deletingServerIds}
            onConnectServer={(serverId) => void handleConnectServer(serverId)}
            onDisconnectServer={(serverId) => void handleDisconnectServer(serverId)}
            connectingServerIds={connectingServerIds}
            disconnectingServerIds={disconnectingServerIds}
          />
        </div>
      </main>
      <InspectorPanel
        isExpanded={isInspectorExpanded}
        selectedServer={selectedServer}
        onClearSelection={() => setSelectedServerId(null)}
        onExpandedChange={setIsInspectorExpanded}
        onConnect={(serverId) => void handleConnectServer(serverId)}
        onDisconnect={(serverId) => void handleDisconnectServer(serverId)}
        isConnecting={selectedServer ? connectingServerIds.has(selectedServer.id) : false}
        isDisconnecting={selectedServer ? disconnectingServerIds.has(selectedServer.id) : false}
      />
      <AddServerDialog
        open={isAddServerDialogOpen}
        onOpenChange={setIsAddServerDialogOpen}
        onServerCreated={handleServerCreated}
      />
    </div>
  );
}
