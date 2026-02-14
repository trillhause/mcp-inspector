import { FileJson2, MessageSquareText, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export type ToolCapability = {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
};

export type ResourceCapability = {
  uri: string;
  name: string;
  description: string | null;
  mimeType: string | null;
};

export type PromptCapability = {
  name: string;
  description: string | null;
  arguments: Array<{
    name: string;
    description: string | null;
    required: boolean;
  }>;
};

export function CapabilityEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function ToolCapabilityRow({ tool }: { tool: ToolCapability }) {
  const hasSchema = Object.keys(tool.inputSchema).length > 0;

  return (
    <li className="rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Wrench className="size-4 text-muted-foreground" aria-hidden="true" />
            <p className="truncate text-sm font-medium">{tool.name}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {tool.description ?? "No description provided."}
          </p>
        </div>
        <Badge variant={hasSchema ? "secondary" : "outline"} className="shrink-0">
          <FileJson2 className="size-3" aria-hidden="true" />
          {hasSchema ? "Schema" : "No Schema"}
        </Badge>
      </div>
    </li>
  );
}

export function ResourceCapabilityRow({ resource }: { resource: ResourceCapability }) {
  return (
    <li className="rounded-lg border bg-background p-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{resource.name}</p>
          {resource.mimeType ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {resource.mimeType}
            </Badge>
          ) : null}
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">{resource.uri}</p>
        <p className="text-xs text-muted-foreground">
          {resource.description ?? "No description provided."}
        </p>
      </div>
    </li>
  );
}

export function PromptCapabilityRow({ prompt }: { prompt: PromptCapability }) {
  const requiredArgs = prompt.arguments.filter((item) => item.required).length;

  return (
    <li className="rounded-lg border bg-background p-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <MessageSquareText className="size-4 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">{prompt.name}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {prompt.description ?? "No description provided."}
        </p>
        <p className="text-xs text-muted-foreground">
          {prompt.arguments.length} arguments
          {prompt.arguments.length > 0 ? ` (${requiredArgs} required)` : ""}
        </p>
      </div>
    </li>
  );
}
