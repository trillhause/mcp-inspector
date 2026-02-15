import { Card } from "@/components/ui/card";
import type { McpServer } from "@/lib/types";

import { ServerCard } from "./server-card";

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
  const preconfiguredServers = servers.filter((server) => server.is_preconfigured);
  const customServers = servers.filter((server) => !server.is_preconfigured);

  if (isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">Servers</h2>
        <ServerCardSkeletonList />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <ServerSection
        title="Pre-configured Servers"
        emptyMessage="No pre-configured servers found."
        servers={preconfiguredServers}
        selectedServerId={selectedServerId}
        onSelectServer={onSelectServer}
        onDeleteServer={onDeleteServer}
        deletingServerIds={deletingServerIds}
        onConnectServer={onConnectServer}
        onDisconnectServer={onDisconnectServer}
        connectingServerIds={connectingServerIds}
        disconnectingServerIds={disconnectingServerIds}
      />
      <ServerSection
        title="Custom Servers"
        emptyMessage="No custom servers yet. Add one to get started."
        servers={customServers}
        selectedServerId={selectedServerId}
        onSelectServer={onSelectServer}
        onDeleteServer={onDeleteServer}
        deletingServerIds={deletingServerIds}
        onConnectServer={onConnectServer}
        onDisconnectServer={onDisconnectServer}
        connectingServerIds={connectingServerIds}
        disconnectingServerIds={disconnectingServerIds}
      />
    </section>
  );
}

type ServerSectionProps = {
  title: string;
  emptyMessage: string;
  servers: McpServer[];
  selectedServerId: string | null;
  onSelectServer: (serverId: string) => void;
  onDeleteServer?: (serverId: string) => void;
  onConnectServer?: (serverId: string) => void;
  onDisconnectServer?: (serverId: string) => void;
  deletingServerIds?: ReadonlySet<string>;
  connectingServerIds?: ReadonlySet<string>;
  disconnectingServerIds?: ReadonlySet<string>;
};

function ServerSection({
  title,
  emptyMessage,
  servers,
  selectedServerId,
  onSelectServer,
  onDeleteServer,
  onConnectServer,
  onDisconnectServer,
  deletingServerIds,
  connectingServerIds,
  disconnectingServerIds,
}: ServerSectionProps) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">{title}</h2>
      {servers.length > 0 ? (
        <div className="flex flex-col gap-2">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              isSelected={selectedServerId === server.id}
              onSelect={onSelectServer}
              onDelete={onDeleteServer}
              onConnect={onConnectServer}
              onDisconnect={onDisconnectServer}
              isDeleting={deletingServerIds?.has(server.id) ?? false}
              isConnecting={connectingServerIds?.has(server.id) ?? false}
              isDisconnecting={disconnectingServerIds?.has(server.id) ?? false}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

function ServerCardSkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="p-3">
          <div className="flex animate-pulse items-center gap-3">
            <div className="size-8 shrink-0 rounded-md bg-muted" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3.5 w-28 rounded bg-muted" />
              <div className="h-3 w-16 rounded bg-muted" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
