import "server-only";

import {
  upsertDiscoveredCapabilities,
  type CachedCapabilitiesRecord,
} from "@/lib/mcp/capabilities-store";
import { discoverCapabilities } from "@/lib/mcp/discovery";

export const DEFAULT_CAPABILITIES_CACHE_TTL_MS = 15 * 60 * 1000;
const CAPABILITIES_REFRESH_TIMEOUT_MS = 20_000;
const MAX_INFLIGHT_REUSE_AGE_MS = 20_000;

type InflightRefreshEntry = {
  startedAtMs: number;
  promise: Promise<CachedCapabilitiesRecord>;
};

const inflightRefreshByServer = new Map<string, InflightRefreshEntry>();

export type CapabilitiesRefreshReason =
  | "oauth_callback"
  | "manual_refresh"
  | "cache_miss"
  | "cache_stale_ttl";

export type RefreshCapabilitiesInput = {
  mcpServerId: string;
  reason: CapabilitiesRefreshReason;
};

function logCapabilitiesRefreshEvent(
  level: "info" | "warn" | "error",
  event: string,
  context: Record<string, unknown>,
) {
  const message = `[mcp-capabilities] ${event}`;

  if (level === "warn") {
    console.warn(message, context);
    return;
  }

  if (level === "error") {
    console.error(message, context);
    return;
  }

  console.info(message, context);
}

async function refreshCapabilitiesInternal(
  input: RefreshCapabilitiesInput,
): Promise<CachedCapabilitiesRecord> {
  const discovered = await withTimeout(
    discoverCapabilities(input.mcpServerId),
    CAPABILITIES_REFRESH_TIMEOUT_MS,
    `Capabilities refresh timed out after ${CAPABILITIES_REFRESH_TIMEOUT_MS}ms`,
  );
  const persisted = upsertDiscoveredCapabilities(discovered);

  logCapabilitiesRefreshEvent("info", "capabilities_refreshed", {
    mcp_server_id: input.mcpServerId,
    reason: input.reason,
    tools_count: persisted.tools.length,
    resources_count: persisted.resources.length,
    prompts_count: persisted.prompts?.length ?? 0,
  });

  return persisted;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    void promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export async function refreshCapabilitiesForServer(
  input: RefreshCapabilitiesInput,
): Promise<CachedCapabilitiesRecord> {
  const existing = inflightRefreshByServer.get(input.mcpServerId);
  if (existing) {
    const ageMs = Date.now() - existing.startedAtMs;
    if (ageMs > MAX_INFLIGHT_REUSE_AGE_MS) {
      inflightRefreshByServer.delete(input.mcpServerId);
      logCapabilitiesRefreshEvent("warn", "capabilities_refresh_inflight_stale_discarded", {
        mcp_server_id: input.mcpServerId,
        reason: input.reason,
        age_ms: ageMs,
      });
    } else {
      logCapabilitiesRefreshEvent("info", "capabilities_refresh_single_flight_reused", {
        mcp_server_id: input.mcpServerId,
        reason: input.reason,
      });
      return existing.promise;
    }
  }

  const startedAtMs = Date.now();
  const promise = refreshCapabilitiesInternal(input).finally(() => {
    const current = inflightRefreshByServer.get(input.mcpServerId);
    if (current?.promise === promise) {
      inflightRefreshByServer.delete(input.mcpServerId);
    }
  });

  inflightRefreshByServer.set(input.mcpServerId, {
    startedAtMs,
    promise,
  });
  return promise;
}

export function enqueueCapabilitiesRefresh(input: RefreshCapabilitiesInput) {
  const existing = inflightRefreshByServer.get(input.mcpServerId);
  if (existing) {
    const ageMs = Date.now() - existing.startedAtMs;
    if (ageMs <= MAX_INFLIGHT_REUSE_AGE_MS) {
      return;
    }

    inflightRefreshByServer.delete(input.mcpServerId);
    logCapabilitiesRefreshEvent("warn", "capabilities_refresh_inflight_stale_discarded", {
      mcp_server_id: input.mcpServerId,
      reason: input.reason,
      age_ms: ageMs,
    });
  }

  void refreshCapabilitiesForServer(input).catch((error) => {
    logCapabilitiesRefreshEvent("warn", "capabilities_background_refresh_failed", {
      mcp_server_id: input.mcpServerId,
      reason: input.reason,
      message: error instanceof Error ? error.message : "unknown error",
    });
  });
}

export function getCapabilitiesCacheAgeMs(lastDiscoveredAt: string, now = new Date()) {
  const discoveredAtMs = Date.parse(lastDiscoveredAt);
  if (Number.isNaN(discoveredAtMs)) {
    return null;
  }

  return Math.max(0, now.getTime() - discoveredAtMs);
}
