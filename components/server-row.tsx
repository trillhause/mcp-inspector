"use client";

import Image from "next/image";
import { Loader2, LogIn, LogOut, Trash2, Unplug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConnectionStatus, McpServer } from "@/lib/types";

type ServerRowProps = {
  server: McpServer;
  isSelected?: boolean;
  onSelect: (serverId: string) => void;
  onConnect?: (serverId: string) => void;
  onDisconnect?: (serverId: string) => void;
  onDelete?: (serverId: string) => void;
  isConnecting?: boolean;
  isDisconnecting?: boolean;
  isDeleting?: boolean;
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-500",
  disconnected: "bg-muted-foreground/40",
  expired: "bg-amber-500",
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Connected",
  disconnected: "Not connected",
  expired: "Expired",
};

export function ServerRow({
  server,
  isSelected = false,
  onSelect,
  onConnect,
  onDisconnect,
  onDelete,
  isConnecting = false,
  isDisconnecting = false,
  isDeleting = false,
}: ServerRowProps) {
  const isBusy = isConnecting || isDisconnecting || isDeleting;
  const isConnected = server.connection_status === "connected";
  const isExpired = server.connection_status === "expired";

  const capabilityHint =
    server.tool_count != null && server.tool_count > 0
      ? `${server.tool_count} tool${server.tool_count === 1 ? "" : "s"}`
      : null;

  return (
    <li
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      onClick={() => onSelect(server.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(server.id);
        }
      }}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
        "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected && "bg-accent ring-1 ring-primary/30",
      )}
    >
      <Image
        src={server.icon_url}
        alt=""
        width={24}
        height={24}
        className="shrink-0 rounded border bg-background p-0.5"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[server.connection_status])}
            aria-label={STATUS_LABEL[server.connection_status]}
          />
          <span className="truncate text-sm font-medium">{server.name}</span>
        </div>
        {capabilityHint ? (
          <p className="ml-3 truncate text-[11px] text-muted-foreground">{capabilityHint}</p>
        ) : null}
      </div>

      {/* Quick actions - visible on hover or when row is selected */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          isSelected && "opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {isConnected ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onDisconnect?.(server.id)}
            disabled={isBusy}
            aria-label={`Disconnect ${server.name}`}
          >
            {isDisconnecting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Unplug className="size-3" />
            )}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onConnect?.(server.id)}
            disabled={isBusy}
            aria-label={`${isExpired ? "Reconnect" : "Connect"} ${server.name}`}
          >
            {isConnecting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <LogIn className="size-3" />
            )}
          </Button>
        )}

        {!server.is_preconfigured ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete?.(server.id)}
            disabled={isBusy}
            aria-label={`Delete ${server.name}`}
          >
            {isDeleting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
