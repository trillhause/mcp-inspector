"use client";

import { useState } from "react";

import { Header } from "@/components/header";
import { ServerGrid } from "@/components/server-grid";

export default function Home() {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background">
      <Header />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <ServerGrid selectedServerId={selectedServerId} onSelectServer={setSelectedServerId} />
      </main>
      <div className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-6 lg:px-8">
        Inspector panel placeholder
      </div>
    </div>
  );
}
