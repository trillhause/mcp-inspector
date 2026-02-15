"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
  LoadingSection,
  SkeletonRow,
} from "@/components/loading-state-primitives";
import { Input } from "@/components/ui/input";
import type { McpServer } from "@/lib/types";

import { ServerRow } from "./server-row";

type ServerGridProps = {
  servers: McpServer[];
  isLoading: boolean;
  selectedServerId: string | null;
  onSelectServer: (serverId: string) => void;
  onDeleteServer?: (serverId: string) => void;
  onConnectServer?: (serverId: string) => void;
  onDisconnectServer?: (serverId: string) => void;
  deletingServerIds?: ReadonlySet<string>;
  connectingServerIds?: ReadonlySet<string>;
  disconnectingServerIds?: ReadonlySet<string>;
};

function matchesFilter(server: McpServer, query: string): boolean {
  const q = query.toLowerCase();
  return (
    server.name.toLowerCase().includes(q) ||
    server.description.toLowerCase().includes(q) ||
    server.mcp_url.toLowerCase().includes(q)
  );
}

export function ServerGrid({
  servers,
  isLoading,
  selectedServerId,
  onSelectServer,
  onDeleteServer,
  onConnectServer,
  onDisconnectServer,
  deletingServerIds,
  connectingServerIds,
  disconnectingServerIds,
}: ServerGridProps) {
  const [filterQuery, setFilterQuery] = useState("");

  const filtered = useMemo(() => {
    if (!filterQuery.trim()) return servers;
    return servers.filter((s) => matchesFilter(s, filterQuery.trim()));
  }, [servers, filterQuery]);

  const preconfigured = useMemo(
    () => filtered.filter((s) => s.is_preconfigured),
    [filtered],
  );
  const custom = useMemo(
    () => filtered.filter((s) => !s.is_preconfigured),
    [filtered],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <SidebarSkeletonList />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {servers.length > 3 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Filter servers..."
            aria-label="Filter servers"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      ) : null}

      {filterQuery.trim() && filtered.length === 0 ? (
        <p className="px-2 py-4 text-center text-sm text-muted-foreground">
          No servers match &ldquo;{filterQuery.trim()}&rdquo;
        </p>
      ) : (
        <>
          <ServerSection
            title="Pre-configured"
            servers={preconfigured}
            selectedServerId={selectedServerId}
            onSelectServer={onSelectServer}
            onConnectServer={onConnectServer}
            onDisconnectServer={onDisconnectServer}
            onDeleteServer={onDeleteServer}
            connectingServerIds={connectingServerIds}
            disconnectingServerIds={disconnectingServerIds}
            deletingServerIds={deletingServerIds}
          />
          <ServerSection
            title="Custom"
            emptyMessage="No custom servers yet."
            servers={custom}
            selectedServerId={selectedServerId}
            onSelectServer={onSelectServer}
            onConnectServer={onConnectServer}
            onDisconnectServer={onDisconnectServer}
            onDeleteServer={onDeleteServer}
            connectingServerIds={connectingServerIds}
            disconnectingServerIds={disconnectingServerIds}
            deletingServerIds={deletingServerIds}
          />
        </>
      )}
    </div>
  );
}

type ServerSectionProps = {
  title: string;
  emptyMessage?: string;
  servers: McpServer[];
  selectedServerId: string | null;
  onSelectServer: (serverId: string) => void;
  onConnectServer?: (serverId: string) => void;
  onDisconnectServer?: (serverId: string) => void;
  onDeleteServer?: (serverId: string) => void;
  connectingServerIds?: ReadonlySet<string>;
  disconnectingServerIds?: ReadonlySet<string>;
  deletingServerIds?: ReadonlySet<string>;
};

function ServerSection({
  title,
  emptyMessage,
  servers,
  selectedServerId,
  onSelectServer,
  onConnectServer,
  onDisconnectServer,
  onDeleteServer,
  connectingServerIds,
  disconnectingServerIds,
  deletingServerIds,
}: ServerSectionProps) {
  if (servers.length === 0 && !emptyMessage) return null;

  return (
    <section className="space-y-1">
      <h2 className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {servers.length > 0 ? (
        <ul role="listbox" aria-label={title} className="flex flex-col gap-0.5">
          {servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              isSelected={selectedServerId === server.id}
              onSelect={onSelectServer}
              onConnect={onConnectServer}
              onDisconnect={onDisconnectServer}
              onDelete={onDeleteServer}
              isConnecting={connectingServerIds?.has(server.id) ?? false}
              isDisconnecting={disconnectingServerIds?.has(server.id) ?? false}
              isDeleting={deletingServerIds?.has(server.id) ?? false}
            />
          ))}
        </ul>
      ) : emptyMessage ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</p>
      ) : null}
    </section>
  );
}

function SidebarSkeletonList() {
  return (
    <LoadingSection className="flex flex-col gap-1" label="Loading servers">
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonRow key={index} />
      ))}
    </LoadingSection>
  );
}
