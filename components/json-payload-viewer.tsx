"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const JSON_TOKEN_REGEX =
  /"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export type PayloadFormat = "json" | "text";

export type NormalizedPayload = {
  format: PayloadFormat;
  text: string;
};

function safeJsonStringify(value: unknown) {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(
      value,
      (_, nestedValue) => {
        if (typeof nestedValue === "bigint") {
          return nestedValue.toString();
        }

        if (typeof nestedValue === "function") {
          return "[Function]";
        }

        if (nestedValue === undefined) {
          return "[undefined]";
        }

        if (nestedValue && typeof nestedValue === "object") {
          if (seen.has(nestedValue)) {
            return "[Circular]";
          }
          seen.add(nestedValue);
        }

        return nestedValue;
      },
      2,
    );
  } catch {
    return null;
  }
}

function normalizeTextPayload(value: unknown) {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "(no content)";
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

function tryParseJsonText(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function normalizePayload(value: unknown): NormalizedPayload {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      const parsed = tryParseJsonText(trimmed);
      if (parsed !== null) {
        const serialized = safeJsonStringify(parsed);
        if (serialized) {
          return {
            format: "json",
            text: serialized,
          };
        }
      }
    }

    return {
      format: "text",
      text: value,
    };
  }

  const serialized = safeJsonStringify(value);
  if (serialized) {
    return {
      format: "json",
      text: serialized,
    };
  }

  return {
    format: "text",
    text: normalizeTextPayload(value),
  };
}

function classifyToken(token: string) {
  if (token === "true" || token === "false") {
    return "text-blue-700 dark:text-blue-300";
  }

  if (token === "null") {
    return "text-muted-foreground";
  }

  if (!Number.isNaN(Number(token))) {
    return "text-amber-700 dark:text-amber-300";
  }

  if (/:\s*$/.test(token)) {
    return "text-sky-700 dark:text-sky-300";
  }

  return "text-emerald-700 dark:text-emerald-300";
}

function renderJsonTokens(jsonText: string) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  const iterator = jsonText.matchAll(JSON_TOKEN_REGEX);

  for (const match of iterator) {
    if (typeof match.index !== "number") {
      continue;
    }

    const start = match.index;
    const token = match[0];
    const end = start + token.length;

    if (start > cursor) {
      nodes.push(
        <span key={`plain-${index}`}>{jsonText.slice(cursor, start)}</span>,
      );
      index += 1;
    }

    nodes.push(
      <span key={`token-${index}`} className={classifyToken(token)}>
        {token}
      </span>,
    );
    index += 1;
    cursor = end;
  }

  if (cursor < jsonText.length) {
    nodes.push(
      <span key={`plain-${index}`}>{jsonText.slice(cursor)}</span>,
    );
  }

  return nodes;
}

export function JsonPayloadViewer({
  value,
  className,
  maxHeightClassName = "max-h-72",
}: {
  value: unknown;
  className?: string;
  maxHeightClassName?: string;
}) {
  const normalized = normalizePayload(value);

  return (
    <pre
      className={cn(
        "overflow-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed whitespace-pre",
        maxHeightClassName,
        className,
      )}
    >
      <code>
        {normalized.format === "json"
          ? renderJsonTokens(normalized.text)
          : normalized.text}
      </code>
    </pre>
  );
}
