import { Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";

type HeaderProps = {
  onAddServer: () => void;
  isAddServerDisabled?: boolean;
};

export function Header({ onAddServer, isAddServerDisabled = false }: HeaderProps) {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Terminal className="size-5 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold tracking-tight">MCP Client</h1>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onAddServer}
          disabled={isAddServerDisabled}
        >
          Add Server
        </Button>
      </div>
    </header>
  );
}
