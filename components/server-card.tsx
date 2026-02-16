"use client";

import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ConnectionStatus, McpServer } from "@/lib/types";

type ServerCardProps = {
  server: McpServer;
  isSelected?: boolean;
  onSelect?: (serverId: string) => void;
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

export function ServerCard({ server, isSelected = false, onSelect }: ServerCardProps) {
  const status = STATUS_STYLES[server.connection_status];

  const handleSelect = () => {
    onSelect?.(server.id);
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSelect();
        }
      }}
      className={cn(
        "h-full gap-4 py-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
        isSelected && "border-primary ring-1 ring-primary/40",
      )}
    >
      <CardHeader className="px-5 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src={server.icon_url}
              alt={`${server.name} icon`}
              width={32}
              height={32}
              className="rounded-md border bg-background p-1"
            />
            <CardTitle className="truncate text-base">{server.name}</CardTitle>
          </div>
          <Badge className={status.className}>{status.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 px-5">
        <CardDescription className="line-clamp-2 min-h-10 text-sm leading-5">
          {server.description}
        </CardDescription>
        {server.connection_status === "connected" &&
        server.tool_count !== null &&
        server.resource_count !== null ? (
          <p className="text-xs text-muted-foreground">
            {server.tool_count} tools · {server.resource_count} resources
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No capabilities discovered yet</p>
        )}
        <Button type="button" className="mt-auto w-full" disabled>
          Connect
        </Button>
      </CardContent>
    </Card>
  );
}
