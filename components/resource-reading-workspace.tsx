"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Loader2, RotateCcw } from "lucide-react";

import type { ResourceCapability } from "@/components/capability-list-rows";
import { InteractionResultMetadata } from "@/components/interaction-result-metadata";
import {
  JsonPayloadViewer,
  normalizePayload,
} from "@/components/json-payload-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildMcpSurfaceErrorDiagnostics,
  normalizeMcpSurfaceError,
  resolveMcpSurfaceErrorAction,
  type McpSurfaceError,
} from "@/lib/mcp/interaction-error-ui";
import type {
  InteractionRunState,
  ReadResourceSuccessResponse,
} from "@/lib/mcp/interaction-contract";
import { cn } from "@/lib/utils";

type ResourceReadingWorkspaceProps = {
  serverId: string;
  serverName: string;
  resources: ResourceCapability[];
  onReconnect?: () => void;
  onRefreshCapabilities?: () => void;
};

type ResourceReadError = McpSurfaceError & {
  source: "client" | "server" | "network";
  failedAt: string;
  targetUri: string;
};

type ReadResourceApiErrorPayload = {
  error?: {
    code?: string;
    category?: string;
    message?: string;
    details?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeReadResourceSuccess(payload: unknown): ReadResourceSuccessResponse | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (!isRecord(payload.target) || payload.target.type !== "resource") {
    return null;
  }

  if (payload.status !== "success") {
    return null;
  }

  return payload as ReadResourceSuccessResponse;
}

function isJsonMimeType(mimeType: string | null) {
  if (!mimeType) {
    return false;
  }

  const normalized = mimeType.toLowerCase();
  return normalized === "application/json" || normalized.endsWith("+json");
}

function isMarkdownMimeType(mimeType: string | null) {
  if (!mimeType) {
    return false;
  }

  const normalized = mimeType.toLowerCase();
  return (
    normalized === "text/markdown" ||
    normalized === "text/x-markdown" ||
    normalized.endsWith("+markdown")
  );
}

function isTextLikeMimeType(mimeType: string | null) {
  if (!mimeType) {
    return false;
  }

  const normalized = mimeType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml")
  );
}

function parseJsonText(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function estimateBase64ByteLength(base64: string) {
  const normalized = base64.replace(/\s+/g, "");
  if (!normalized) {
    return 0;
  }

  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;

  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function getBlobPreviewInfo(result: unknown) {
  if (!isRecord(result) || !Array.isArray(result.contents) || result.contents.length === 0) {
    return { hasBlob: false, estimatedBytes: null as number | null };
  }

  const firstItem = result.contents[0];
  if (!isRecord(firstItem) || typeof firstItem.blob !== "string") {
    return { hasBlob: false, estimatedBytes: null as number | null };
  }

  return {
    hasBlob: true,
    estimatedBytes: estimateBase64ByteLength(firstItem.blob),
  };
}

function buildErrorDiagnostics(
  error: ResourceReadError,
  serverName: string,
) {
  return buildMcpSurfaceErrorDiagnostics(
    error,
    {
      source: error.source,
      server: serverName,
      target_resource_uri: error.targetUri,
      failed_at: error.failedAt,
    },
  );
}

function ResourceContentViewer({ result }: { result: ReadResourceSuccessResponse }) {
  const mimeType =
    normalizeOptionalString(result.mimeType) ??
    normalizeOptionalString(result.content_type);
  const preview = normalizeOptionalString(result.preview);
  const blobInfo = getBlobPreviewInfo(result.result);

  if (preview) {
    if (isJsonMimeType(mimeType)) {
      const parsed = parseJsonText(preview);
      if (parsed !== null) {
        return <JsonPayloadViewer value={parsed} maxHeightClassName="max-h-96" />;
      }
    }

    if (isJsonMimeType(mimeType) || parseJsonText(preview) !== null) {
      return <JsonPayloadViewer value={preview} maxHeightClassName="max-h-96" />;
    }

    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {isMarkdownMimeType(mimeType)
            ? "Markdown preview"
            : "Text preview"}
        </p>
        <pre className="max-h-96 overflow-auto rounded-md border bg-background p-3 text-xs whitespace-pre-wrap break-words">
          {preview}
        </pre>
      </div>
    );
  }

  if (blobInfo.hasBlob || !isTextLikeMimeType(mimeType)) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="font-medium">Binary or unsupported preview content.</p>
        <p className="mt-1">
          Use <span className="font-medium">Copy Payload</span> to inspect the raw response JSON.
        </p>
        {blobInfo.estimatedBytes !== null ? (
          <p className="mt-2 font-mono">estimated_bytes={blobInfo.estimatedBytes}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        No preview text was returned. Showing sanitized response payload.
      </p>
      <JsonPayloadViewer value={result.result} maxHeightClassName="max-h-96" />
    </div>
  );
}

export function ResourceReadingWorkspace({
  serverId,
  serverName,
  resources,
  onReconnect,
  onRefreshCapabilities,
}: ResourceReadingWorkspaceProps) {
  const [selectedResourceUri, setSelectedResourceUri] = useState(resources[0]?.uri ?? "");
  const [runState, setRunState] = useState<InteractionRunState>("idle");
  const [readResult, setReadResult] = useState<ReadResourceSuccessResponse | null>(null);
  const [readError, setReadError] = useState<ResourceReadError | null>(null);
  const [lastReadUri, setLastReadUri] = useState<string | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);

  const resolvedResource = useMemo(() => {
    if (resources.length === 0) {
      return null;
    }

    return (
      resources.find((resource) => resource.uri === selectedResourceUri) ?? resources[0]
    );
  }, [resources, selectedResourceUri]);

  const copyText = useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setClipboardNotice(successMessage);
    } catch {
      setClipboardNotice("Clipboard copy failed.");
    }
  }, []);

  const executeRead = useCallback(
    async (uri: string) => {
      setRunState("executing");
      setReadResult(null);
      setReadError(null);

      try {
        const response = await fetch(
          `/api/mcp/${encodeURIComponent(serverId)}/resources/read`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ uri }),
          },
        );

        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          const normalizedPayload = (isRecord(payload) ? payload : {}) as ReadResourceApiErrorPayload;
          const normalizedError = normalizeMcpSurfaceError(normalizedPayload, {
            fallbackCode: "READ_FAILED",
            fallbackMessage: `Resource read failed (HTTP ${response.status})`,
          });
          setReadError({
            ...normalizedError,
            source: "server",
            failedAt: new Date().toISOString(),
            targetUri: uri,
          });
          setRunState("error");
          return;
        }

        const normalized = normalizeReadResourceSuccess(payload);
        if (!normalized) {
          const normalizedError = normalizeMcpSurfaceError(
            {
              error: {
                code: "INTERNAL_ERROR",
                message: "Resource read succeeded but payload was invalid.",
              },
            },
            {
              fallbackCode: "INTERNAL_ERROR",
              fallbackMessage: "Resource read succeeded but payload was invalid.",
            },
          );
          setReadError({
            ...normalizedError,
            source: "client",
            failedAt: new Date().toISOString(),
            targetUri: uri,
          });
          setRunState("error");
          return;
        }

        setReadResult(normalized);
        setRunState("success");
      } catch (error) {
        const normalizedError = normalizeMcpSurfaceError(
          {
            error: {
              code: "NETWORK_ERROR",
              message: error instanceof Error ? error.message : "Resource read request failed.",
            },
          },
          {
            fallbackCode: "NETWORK_ERROR",
            fallbackMessage: "Resource read request failed.",
          },
        );
        setReadError({
          ...normalizedError,
          source: "network",
          failedAt: new Date().toISOString(),
          targetUri: uri,
        });
        setRunState("error");
      }
    },
    [serverId],
  );

  const handleRead = useCallback(() => {
    if (!resolvedResource || runState === "executing") {
      return;
    }

    setLastReadUri(resolvedResource.uri);
    void executeRead(resolvedResource.uri);
  }, [executeRead, resolvedResource, runState]);

  const handleRetry = useCallback(() => {
    if (!lastReadUri || runState === "executing") {
      return;
    }

    void executeRead(lastReadUri);
  }, [executeRead, lastReadUri, runState]);

  const readErrorDiagnostics = readError
    ? buildErrorDiagnostics(readError, serverName)
    : null;
  const readErrorAction = readError
    ? resolveMcpSurfaceErrorAction(readError, {
        retry: handleRetry,
        reconnect: onReconnect,
        refreshCapabilities: onRefreshCapabilities,
        checkEndpoint: handleRetry,
      })
    : null;

  if (resources.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
        No resources discovered for this server.
      </p>
    );
  }

  const readTargetLabel = readResult
    ? (() => {
        const matched = resources.find((resource) => resource.uri === readResult.target.uri);
        return matched ? `${matched.name} (${readResult.target.uri})` : readResult.target.uri;
      })()
    : resolvedResource?.name ?? resolvedResource?.uri ?? "resource";

  return (
    <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(220px,300px)_1fr]">
      <section className="min-h-0 rounded-lg border bg-background p-2">
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">Select a resource</p>
        <ul className="space-y-1">
          {resources.map((resource) => {
            const isSelected = resource.uri === resolvedResource?.uri;
            return (
              <li key={resource.uri}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:border-border hover:bg-muted/60",
                  )}
                  onClick={() => setSelectedResourceUri(resource.uri)}
                  aria-pressed={isSelected}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{resource.name}</p>
                    {resource.mimeType ? (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {resource.mimeType}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                    {resource.uri}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="min-h-0 rounded-lg border bg-background p-3">
        {resolvedResource ? (
          <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{resolvedResource.name}</h3>
                <Badge variant="outline">{runState}</Badge>
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {resolvedResource.uri}
              </p>
              <p className="text-xs text-muted-foreground">
                {resolvedResource.description ?? "No description provided."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={handleRead} disabled={runState === "executing"}>
                {runState === "executing" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Reading...
                  </>
                ) : (
                  "Read Resource"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleRetry}
                disabled={!lastReadUri || runState === "executing"}
              >
                <RotateCcw className="size-4" />
                Retry Last Read
              </Button>
              {clipboardNotice ? (
                <p className="text-xs text-muted-foreground">{clipboardNotice}</p>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {readError ? (
                <div
                  className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
                  role="alert"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="size-4" />
                    {readError.message}
                  </div>
                  {readError.details.length > 0 ? (
                    <ul className="list-disc pl-4">
                      {readError.details.map((detail, index) => (
                        <li key={`${detail}-${index}`}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="text-[11px]">
                    {readErrorAction?.hint ??
                      "Retry this action and inspect diagnostics if the issue persists."}
                  </p>
                  {readErrorAction?.onClick ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={readErrorAction.onClick}
                      disabled={runState === "executing"}
                    >
                      {readErrorAction.label}
                    </Button>
                  ) : null}
                  <pre className="max-h-48 overflow-auto rounded border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground">
                    {readErrorDiagnostics}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void copyText(
                        readErrorDiagnostics ?? "",
                        "Copied error diagnostics.",
                      )
                    }
                  >
                    <Copy className="size-4" />
                    Copy Diagnostics
                  </Button>
                </div>
              ) : null}

              {readResult ? (
                <div
                  className="space-y-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-800 dark:text-emerald-200"
                  role="status"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="size-4" />
                    Resource read succeeded in {readResult.latency_ms} ms
                  </div>
                  <InteractionResultMetadata
                    serverName={serverName}
                    targetLabel={readTargetLabel}
                    executedAt={readResult.executed_at}
                    latencyMs={readResult.latency_ms}
                    contentType={readResult.content_type}
                    isTruncated={readResult.is_truncated}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copyText(
                          normalizePayload(readResult.result).text,
                          "Copied response payload.",
                        )
                      }
                    >
                      <Copy className="size-4" />
                      Copy Payload
                    </Button>
                  </div>
                  <ResourceContentViewer result={readResult} />
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Read a resource to view text/JSON preview content and raw response metadata.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Select a resource to inspect.</p>
        )}
      </section>
    </div>
  );
}
