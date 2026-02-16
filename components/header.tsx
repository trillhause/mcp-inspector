import { PanelLeft, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";

type HeaderProps = {
  onAddServer: () => void;
  isAddServerDisabled?: boolean;
  onOpenServerSheet?: () => void;
  isServerSheetOpen?: boolean;
};

export function Header({ onAddServer, isAddServerDisabled = false, onOpenServerSheet, isServerSheetOpen = false }: HeaderProps) {
  return (
    <header className="border-b">
      <div className="flex h-16 w-full items-center justify-between px-4 sm:px-6 lg:px-8"> 
        <div className="flex items-center gap-2">
          <Terminal className="size-5 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold tracking-tight">MCP Client</h1>
        </div>
        <div className="flex items-center gap-2">
          {onOpenServerSheet ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="md:hidden"
              onClick={onOpenServerSheet}
              aria-label="Open server list"
              aria-expanded={isServerSheetOpen}
            >
              <PanelLeft className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={onAddServer}
            disabled={isAddServerDisabled}
          >
            Add Server
          </Button>
        </div>
      </div>
    </header>
  );
}
