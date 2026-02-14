import { Card } from "@/components/ui/card";
import type { McpServer } from "@/lib/types";

import { ServerCard } from "./server-card";

type ServerGridProps = {
  servers: McpServer[];
  isLoading: boolean;
  selectedServerId: string | null;
  onSelectServer: (serverId: string) => void;
  onDeleteServer?: (serverId: string) => void;
  deletingServerIds?: ReadonlySet<string>;
};

export function ServerGrid({
  servers,
  isLoading,
  selectedServerId,
  onSelectServer,
  onDeleteServer,
  deletingServerIds,
}: ServerGridProps) {
  const preconfiguredServers = servers.filter((server) => server.is_preconfigured);
  const customServers = servers.filter((server) => !server.is_preconfigured);

  if (isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Servers</h2>
        <ServerCardSkeletonGrid />
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <ServerSection
        title="Pre-configured Servers"
        emptyMessage="No pre-configured servers found."
        servers={preconfiguredServers}
        selectedServerId={selectedServerId}
        onSelectServer={onSelectServer}
        onDeleteServer={onDeleteServer}
        deletingServerIds={deletingServerIds}
      />
      <ServerSection
        title="Custom Servers"
        emptyMessage="No custom servers yet. Add one to get started."
        servers={customServers}
        selectedServerId={selectedServerId}
        onSelectServer={onSelectServer}
        onDeleteServer={onDeleteServer}
        deletingServerIds={deletingServerIds}
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
  deletingServerIds?: ReadonlySet<string>;
};

function ServerSection({
  title,
  emptyMessage,
  servers,
  selectedServerId,
  onSelectServer,
  onDeleteServer,
  deletingServerIds,
}: ServerSectionProps) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {servers.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              isSelected={selectedServerId === server.id}
              onSelect={onSelectServer}
              onDelete={onDeleteServer}
              isDeleting={deletingServerIds?.has(server.id) ?? false}
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

function ServerCardSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index} className="h-[232px] p-5">
          <div className="flex h-full animate-pulse flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-md bg-muted" />
                <div className="h-4 w-24 rounded bg-muted" />
              </div>
              <div className="h-5 w-24 rounded-full bg-muted" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
            <div className="h-3 w-36 rounded bg-muted" />
            <div className="mt-auto h-9 w-full rounded bg-muted" />
          </div>
        </Card>
      ))}
    </div>
  );
}
