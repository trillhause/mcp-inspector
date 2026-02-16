"use client";

import Image from "next/image";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

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
};

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
}: {
  server: McpServer;
  onClearSelection: () => void;
}) {
  const status = STATUS_STYLES[server.connection_status];

  return (
    <div className="flex h-full min-h-0 flex-col py-3">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="flex min-w-0 items-center gap-3">
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

      <Tabs value="tools" className="mt-3 min-h-0 flex-1">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="tools" disabled>
            Tools
          </TabsTrigger>
          <TabsTrigger value="resources" disabled>
            Resources
          </TabsTrigger>
          <TabsTrigger value="history" disabled>
            History
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="tools"
          className="mt-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"
        >
          Connect to discover tools
        </TabsContent>
        <TabsContent
          value="resources"
          className="mt-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"
        >
          Connect to discover resources
        </TabsContent>
        <TabsContent
          value="history"
          className="mt-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"
        >
          No execution history
        </TabsContent>
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
