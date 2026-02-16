import { PRECONFIGURED_SERVERS } from "@/lib/data/preconfigured-servers";

import { ServerCard } from "./server-card";

type ServerGridProps = {
  selectedServerId: string | null;
  onSelectServer: (serverId: string) => void;
};

export function ServerGrid({ selectedServerId, onSelectServer }: ServerGridProps) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Servers</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PRECONFIGURED_SERVERS.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            isSelected={selectedServerId === server.id}
            onSelect={onSelectServer}
          />
        ))}
      </div>
    </section>
  );
}
