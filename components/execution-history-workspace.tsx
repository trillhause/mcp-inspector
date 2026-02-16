"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Loader2, RefreshCw } from "lucide-react";

import { JsonPayloadViewer, normalizePayload } from "@/components/json-payload-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ListExecutionHistoryResponse,
  McpExecutionHistoryItem,
} from "@/lib/mcp/interaction-contract";
import { cn } from "@/lib/utils";

type ExecutionHistoryWorkspaceProps = {
  serverId: string;
  serverName: string;
};

const DEFAULT_PAGE_LIMIT = 20;
type HistoryErrorCategory = NonNullable<McpExecutionHistoryItem["error"]>["category"];

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

function normalizeErrorDetails(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeStatus(value: unknown) {
  return value === "success" ? "success" : "error";
}

function normalizeActionType(value: unknown) {
  return value === "resource_read" ? "resource_read" : "tool_execute";
}

function normalizeTargetType(value: unknown) {
  return value === "resource" ? "resource" : "tool";
}

function normalizeLatency(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function normalizeErrorCategory(value: unknown): HistoryErrorCategory {
  if (
    value === "validation" ||
    value === "auth" ||
    value === "connection" ||
    value === "not_found" ||
    value === "execution" ||
    value === "internal"
  ) {
    return value;
  }

  return null;
}

function normalizeHistoryItem(payload: unknown, fallbackIndex: number): McpExecutionHistoryItem {
  if (!isRecord(payload)) {
    return {
      id: `invalid-item-${fallbackIndex}`,
      mcp_server_id: "unknown-mcp-server",
      action_type: "tool_execute",
      target: { type: "tool", value: "unknown-target" },
      status: "error",
      latency_ms: 0,
      request_summary: null,
      request_payload: null,
      response_content_type: null,
      response_payload: null,
      error: {
        code: "INVALID_HISTORY_ITEM",
        category: "internal",
        message: "Execution history item payload was invalid.",
        details: [],
      },
      created_at: new Date().toISOString(),
    };
  }

  const target = isRecord(payload.target) ? payload.target : {};
  const rawError = isRecord(payload.error) ? payload.error : null;

  return {
    id: normalizeOptionalString(payload.id) ?? `history-item-${fallbackIndex}`,
    mcp_server_id: normalizeOptionalString(payload.mcp_server_id) ?? "unknown-mcp-server",
    action_type: normalizeActionType(payload.action_type),
    target: {
      type: normalizeTargetType(target.type),
      value: normalizeOptionalString(target.value) ?? "unknown-target",
    },
    status: normalizeStatus(payload.status),
    latency_ms: normalizeLatency(payload.latency_ms),
    request_summary: normalizeOptionalString(payload.request_summary),
    request_payload: "request_payload" in payload ? payload.request_payload : null,
    response_content_type: normalizeOptionalString(payload.response_content_type),
    response_payload: "response_payload" in payload ? payload.response_payload : null,
    error: rawError
      ? {
          code: normalizeOptionalString(rawError.code) ?? "UNKNOWN_ERROR",
          category: normalizeErrorCategory(rawError.category),
          message: normalizeOptionalString(rawError.message) ?? "Unknown history error",
          details: normalizeErrorDetails(rawError.details),
        }
      : null,
    created_at: normalizeOptionalString(payload.created_at) ?? new Date().toISOString(),
  };
}

function normalizeHistoryList(payload: unknown): ListExecutionHistoryResponse | null {
  if (!isRecord(payload)) {
    return null;
  }

  const items = Array.isArray(payload.items)
    ? payload.items.map((item, index) => normalizeHistoryItem(item, index))
    : [];

  return {
    mcp_server_id: normalizeOptionalString(payload.mcp_server_id) ?? "unknown-mcp-server",
    limit:
      typeof payload.limit === "number" && Number.isFinite(payload.limit) && payload.limit > 0
        ? Math.trunc(payload.limit)
        : DEFAULT_PAGE_LIMIT,
    has_more: payload.has_more === true,
    next_cursor: normalizeOptionalString(payload.next_cursor),
    items,
  };
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function actionLabel(item: McpExecutionHistoryItem) {
  return item.action_type === "tool_execute" ? "Tool execution" : "Resource read";
}

function targetLabel(item: McpExecutionHistoryItem) {
  return item.target.value;
}

function buildDiagnostics(item: McpExecutionHistoryItem, serverName: string) {
  return JSON.stringify(
    {
      id: item.id,
      server: serverName,
      action_type: item.action_type,
      target: item.target,
      status: item.status,
      latency_ms: item.latency_ms,
      request_summary: item.request_summary,
      error: item.error,
      created_at: item.created_at,
    },
    null,
    2,
  );
}

export function ExecutionHistoryWorkspace({
  serverId,
  serverName,
}: ExecutionHistoryWorkspaceProps) {
  const [items, setItems] = useState<McpExecutionHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const selectedItem = useMemo(() => {
    if (items.length === 0) {
      return null;
    }

    if (!selectedItemId) {
      return items[0];
    }

    return items.find((item) => item.id === selectedItemId) ?? items[0];
  }, [items, selectedItemId]);

  useEffect(() => {
    if (!selectedItem && items.length > 0) {
      setSelectedItemId(items[0].id);
      return;
    }

    if (selectedItemId && !items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(items[0]?.id ?? null);
    }
  }, [items, selectedItem, selectedItemId]);

  const copyText = useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setClipboardNotice(successMessage);
    } catch {
      setClipboardNotice("Clipboard copy failed.");
    }
  }, []);

  const fetchHistory = useCallback(
    async ({ cursor, append }: { cursor: string | null; append: boolean }) => {
      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;

      const params = new URLSearchParams({
        limit: String(DEFAULT_PAGE_LIMIT),
      });
      if (cursor) {
        params.set("cursor", cursor);
      }

      const response = await fetch(
        `/api/mcp/${encodeURIComponent(serverId)}/history?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const payload = (await response.json().catch(() => null)) as unknown;
      if (requestSequence !== requestSequenceRef.current) {
        return;
      }

      if (!response.ok) {
        const message =
          normalizeOptionalString(
            isRecord(payload) && isRecord(payload.error) ? payload.error.message : null,
          ) ?? `History request failed (HTTP ${response.status})`;
        throw new Error(message);
      }

      const normalized = normalizeHistoryList(payload);
      if (!normalized) {
        throw new Error("History response payload was invalid.");
      }

      setItems((previousItems) => (append ? [...previousItems, ...normalized.items] : normalized.items));
      setNextCursor(normalized.next_cursor);
      setErrorMessage(null);
    },
    [serverId],
  );

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setClipboardNotice(null);
    setSelectedItemId(null);

    try {
      await fetchHistory({ cursor: null, append: false });
    } catch (error) {
      setItems([]);
      setNextCursor(null);
      setErrorMessage(error instanceof Error ? error.message : "Failed to load history.");
    } finally {
      setIsLoading(false);
    }
  }, [fetchHistory]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || isLoading) {
      return;
    }

    setIsRefreshing(true);
    setClipboardNotice(null);

    try {
      await fetchHistory({ cursor: null, append: false });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to refresh history.");
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchHistory, isLoading, isRefreshing]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    setClipboardNotice(null);

    try {
      await fetchHistory({ cursor: nextCursor, append: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load more history.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchHistory, isLoadingMore, nextCursor]);

  return (
    <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(260px,340px)_1fr]">
      <section className="min-h-0 rounded-lg border bg-background p-2">
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <p className="text-xs font-medium text-muted-foreground">Recent activity</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing || isLoading}
          >
            {isRefreshing ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Refreshing
              </>
            ) : (
              <>
                <RefreshCw className="size-3.5" />
                Refresh
              </>
            )}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2 px-2 pb-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-md border bg-muted/30 p-3">
                <div className="flex animate-pulse flex-col gap-2">
                  <div className="h-3 w-32 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length > 0 ? (
          <div className="flex h-full min-h-0 flex-col gap-2">
            <ul className="min-h-0 space-y-1 overflow-y-auto pr-1">
              {items.map((item) => {
                const selected = item.id === selectedItem?.id;
                const isSuccess = item.status === "success";
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-transparent hover:border-border hover:bg-muted/60",
                      )}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium">{actionLabel(item)}</p>
                        <Badge variant={isSuccess ? "secondary" : "destructive"}>
                          {item.status}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 break-all text-[11px] text-muted-foreground">
                        {targetLabel(item)}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{formatTimestamp(item.created_at)}</span>
                        <span>{item.latency_ms} ms</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {nextCursor ? (
              <Button
                type="button"
                variant="outline"
                className="h-8"
                onClick={() => void handleLoadMore()}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load More"
                )}
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
            No execution history yet. Run a tool or read a resource to populate this list.
          </p>
        )}

        {errorMessage ? (
          <p className="mt-2 px-2 text-xs text-destructive">{errorMessage}</p>
        ) : null}
      </section>

      <section className="min-h-0 min-w-0 rounded-lg border bg-background p-3">
        {selectedItem ? (
          <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {selectedItem.status === "success" ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="size-4 text-destructive" />
                )}
                <h3 className="text-sm font-semibold">{actionLabel(selectedItem)}</h3>
                <Badge variant={selectedItem.status === "success" ? "secondary" : "destructive"}>
                  {selectedItem.status}
                </Badge>
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {targetLabel(selectedItem)}
              </p>
            </div>

            <dl className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
              <div className="rounded border bg-muted/20 px-2 py-1.5">
                <dt className="font-medium">Server</dt>
                <dd className="break-all">{serverName}</dd>
              </div>
              <div className="rounded border bg-muted/20 px-2 py-1.5">
                <dt className="font-medium">Target</dt>
                <dd className="break-all">{targetLabel(selectedItem)}</dd>
              </div>
              <div className="rounded border bg-muted/20 px-2 py-1.5">
                <dt className="font-medium">Executed</dt>
                <dd>{formatTimestamp(selectedItem.created_at)}</dd>
              </div>
              <div className="rounded border bg-muted/20 px-2 py-1.5">
                <dt className="font-medium">Latency</dt>
                <dd>{selectedItem.latency_ms} ms</dd>
              </div>
              {selectedItem.response_content_type ? (
                <div className="rounded border bg-muted/20 px-2 py-1.5 sm:col-span-2">
                  <dt className="font-medium">Content type</dt>
                  <dd className="break-all font-mono">{selectedItem.response_content_type}</dd>
                </div>
              ) : null}
              {selectedItem.request_summary ? (
                <div className="rounded border bg-muted/20 px-2 py-1.5 sm:col-span-2">
                  <dt className="font-medium">Request summary</dt>
                  <dd>{selectedItem.request_summary}</dd>
                </div>
              ) : null}
            </dl>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {selectedItem.error ? (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  <div className="font-medium">
                    {selectedItem.error.message}
                  </div>
                  <p className="font-mono text-[11px]">
                    code={selectedItem.error.code}
                    {selectedItem.error.category
                      ? ` category=${selectedItem.error.category}`
                      : ""}
                  </p>
                  {selectedItem.error.details.length > 0 ? (
                    <ul className="list-disc pl-4">
                      {selectedItem.error.details.map((detail, index) => (
                        <li key={`${detail}-${index}`}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void copyText(
                        buildDiagnostics(selectedItem, serverName),
                        "Copied diagnostics.",
                      )
                    }
                  >
                    <Copy className="size-4" />
                    Copy Diagnostics
                  </Button>
                </div>
              ) : null}

              {selectedItem.request_payload !== null ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Request payload</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copyText(
                          normalizePayload(selectedItem.request_payload).text,
                          "Copied request payload.",
                        )
                      }
                    >
                      <Copy className="size-4" />
                      Copy
                    </Button>
                  </div>
                  <JsonPayloadViewer value={selectedItem.request_payload} maxHeightClassName="max-h-52" />
                </div>
              ) : null}

              {selectedItem.response_payload !== null ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Response payload</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copyText(
                          normalizePayload(selectedItem.response_payload).text,
                          "Copied response payload.",
                        )
                      }
                    >
                      <Copy className="size-4" />
                      Copy
                    </Button>
                  </div>
                  <JsonPayloadViewer
                    value={selectedItem.response_payload}
                    maxHeightClassName="max-h-64"
                  />
                </div>
              ) : null}

              {selectedItem.request_payload === null && selectedItem.response_payload === null ? (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  No stored request or response payload for this record.
                </p>
              ) : null}
            </div>

            {clipboardNotice ? <p className="text-xs text-muted-foreground">{clipboardNotice}</p> : null}
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Select a history entry to inspect request and response details.
          </p>
        )}
      </section>
    </div>
  );
}
