"use client";

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function InteractionResultMetadata({
  serverName,
  targetLabel,
  executedAt,
  latencyMs,
  contentType,
  isTruncated,
}: {
  serverName: string;
  targetLabel: string;
  executedAt: string;
  latencyMs: number;
  contentType: string | null;
  isTruncated?: boolean;
}) {
  return (
    <dl className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
      <div className="rounded border bg-muted/20 px-2 py-1.5">
        <dt className="font-medium">Server</dt>
        <dd className="break-all">{serverName}</dd>
      </div>
      <div className="rounded border bg-muted/20 px-2 py-1.5">
        <dt className="font-medium">Target</dt>
        <dd className="break-all">{targetLabel}</dd>
      </div>
      <div className="rounded border bg-muted/20 px-2 py-1.5">
        <dt className="font-medium">Executed</dt>
        <dd>{formatTimestamp(executedAt)}</dd>
      </div>
      <div className="rounded border bg-muted/20 px-2 py-1.5">
        <dt className="font-medium">Latency</dt>
        <dd>{latencyMs} ms</dd>
      </div>
      {contentType ? (
        <div className="rounded border bg-muted/20 px-2 py-1.5 sm:col-span-2">
          <dt className="font-medium">Content type</dt>
          <dd className="break-all font-mono">{contentType}</dd>
        </div>
      ) : null}
      {isTruncated ? (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-900 sm:col-span-2 dark:text-amber-200">
          <dt className="font-medium">Notice</dt>
          <dd>Payload preview is truncated for safety.</dd>
        </div>
      ) : null}
    </dl>
  );
}
