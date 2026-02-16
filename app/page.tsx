"use client";

import { useEffect, useMemo, useState } from "react";

import { Header } from "@/components/header";
import { InspectorPanel } from "@/components/inspector-panel";
import { ServerGrid } from "@/components/server-grid";
import { PRECONFIGURED_SERVERS } from "@/lib/data/preconfigured-servers";

export default function Home() {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(false);

  const selectedServer = useMemo(
    () => PRECONFIGURED_SERVERS.find((server) => server.id === selectedServerId) ?? null,
    [selectedServerId],
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

  const handleSelectServer = (serverId: string) => {
    setSelectedServerId(serverId);
    setIsInspectorExpanded(true);
  };

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background">
      <Header />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-20 sm:px-6 lg:px-8">
        <ServerGrid selectedServerId={selectedServerId} onSelectServer={handleSelectServer} />
      </main>
      <InspectorPanel
        isExpanded={isInspectorExpanded}
        selectedServer={selectedServer}
        onClearSelection={() => setSelectedServerId(null)}
        onExpandedChange={setIsInspectorExpanded}
      />
    </div>
  );
}
