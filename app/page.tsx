"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AddServerDialog } from "@/components/add-server-dialog";
import { Header } from "@/components/header";
import { InspectorPanel } from "@/components/inspector-panel";
import { ServerGrid } from "@/components/server-grid";
import { Button } from "@/components/ui/button";
import type { McpServer } from "@/lib/types";

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
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(false);
  const [isAddServerDialogOpen, setIsAddServerDialogOpen] = useState(false);
  const [deletingServerIds, setDeletingServerIds] = useState<Set<string>>(new Set());

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
          />
        </div>
      </main>
      <InspectorPanel
        isExpanded={isInspectorExpanded}
        selectedServer={selectedServer}
        onClearSelection={() => setSelectedServerId(null)}
        onExpandedChange={setIsInspectorExpanded}
      />
      <AddServerDialog
        open={isAddServerDialogOpen}
        onOpenChange={setIsAddServerDialogOpen}
        onServerCreated={handleServerCreated}
      />
    </div>
  );
}
