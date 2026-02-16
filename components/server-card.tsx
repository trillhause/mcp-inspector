"use client";

import Image from "next/image";
import { Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ConnectionStatus, McpServer } from "@/lib/types";

type ServerCardProps = {
  server: McpServer;
  isSelected?: boolean;
  onSelect?: (serverId: string) => void;
  onDelete?: (serverId: string) => void;
  onConnect?: (serverId: string) => void;
  onDisconnect?: (serverId: string) => void;
  isDeleting?: boolean;
  isConnecting?: boolean;
  isDisconnecting?: boolean;
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

export function ServerCard({
  server,
  isSelected = false,
  onSelect,
  onDelete,
  isDeleting = false,
}: ServerCardProps) {
  const status = STATUS_STYLES[server.connection_status];

  const handleSelect = () => {
    onSelect?.(server.id);
  };

  const handleDelete = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete?.(server.id);
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
        "flex items-center gap-3 p-3 transition-colors hover:bg-accent/50",
        isSelected && "border-primary bg-accent ring-1 ring-primary/40",
      )}
    >
      <Image
        src={server.icon_url}
        alt={`${server.name} icon`}
        width={28}
        height={28}
        className="shrink-0 rounded-md border bg-background p-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{server.name}</p>
        <Badge className={cn("mt-0.5 text-[10px] px-1.5 py-0", status.className)}>
          {status.label}
        </Badge>
      </div>
      {!server.is_preconfigured ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={handleDelete}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={isDeleting}
          aria-label={`Delete ${server.name}`}
        >
          {isDeleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      ) : null}
    </Card>
  );
}
