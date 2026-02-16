"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { McpServer } from "@/lib/types";

type ServerSettingsWorkspaceProps = {
  server: McpServer;
  onServerUpdated?: (server: McpServer) => void;
};

type ServerSettingsFormState = {
  name: string;
  description: string;
  transport: McpServer["transport"];
  is_enabled: boolean;
};

type ServerSettingsFormErrors = Partial<Record<"name", string>>;

function normalizeDescription(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function createFormState(server: McpServer): ServerSettingsFormState {
  return {
    name: server.name,
    description: server.description,
    transport: server.transport,
    is_enabled: server.is_enabled,
  };
}

function parseApiError(payload: unknown, fallbackMessage: string) {
  if (!payload || typeof payload !== "object") {
    return fallbackMessage;
  }

  const errorValue = (payload as { error?: unknown }).error;
  if (!errorValue || typeof errorValue !== "object") {
    return fallbackMessage;
  }

  const details = (errorValue as { details?: unknown }).details;
  if (Array.isArray(details) && details.length > 0) {
    const detailMessages = details.filter((detail): detail is string => typeof detail === "string");
    if (detailMessages.length > 0) {
      return detailMessages.join(" ");
    }
  }

  const message = (errorValue as { message?: unknown }).message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  return fallbackMessage;
}

function validateForm(
  formState: ServerSettingsFormState,
  options: { canEditIdentity: boolean },
) {
  const errors: ServerSettingsFormErrors = {};
  if (options.canEditIdentity && formState.name.trim().length === 0) {
    errors.name = "Server name is required.";
  }
  return errors;
}

function hasUnsavedChanges(server: McpServer, formState: ServerSettingsFormState) {
  if (server.transport !== formState.transport) {
    return true;
  }

  if (server.is_enabled !== formState.is_enabled) {
    return true;
  }

  if (!server.is_preconfigured) {
    if (server.name !== formState.name.trim()) {
      return true;
    }
    if (normalizeDescription(server.description) !== normalizeDescription(formState.description)) {
      return true;
    }
  }

  return false;
}

export function ServerSettingsWorkspace({ server, onServerUpdated }: ServerSettingsWorkspaceProps) {
  const [formState, setFormState] = useState<ServerSettingsFormState>(() => createFormState(server));
  const [formErrors, setFormErrors] = useState<ServerSettingsFormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const canEditIdentity = !server.is_preconfigured;
  const dirty = useMemo(() => hasUnsavedChanges(server, formState), [formState, server]);
  const serverId = server.id;
  const serverName = server.name;
  const serverDescription = server.description;
  const serverTransport = server.transport;
  const serverEnabled = server.is_enabled;
  const serverIsPreconfigured = server.is_preconfigured;

  useEffect(() => {
    setFormState({
      name: serverName,
      description: serverDescription,
      transport: serverTransport,
      is_enabled: serverEnabled,
    });
    setFormErrors({});
    setIsSaving(false);
    setSaveError(null);
    setSaveSuccess(null);
  }, [
    serverDescription,
    serverEnabled,
    serverId,
    serverIsPreconfigured,
    serverName,
    serverTransport,
  ]);

  useEffect(() => {
    if (!dirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const handleCancel = () => {
    if (isSaving) {
      return;
    }

    setFormState(createFormState(server));
    setFormErrors({});
    setSaveError(null);
    setSaveSuccess(null);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setSaveSuccess(null);

    const validationErrors = validateForm(formState, { canEditIdentity });
    if (Object.keys(validationErrors).length > 0) {
      setFormErrors(validationErrors);
      return;
    }

    const updates: Record<string, unknown> = {};
    if (formState.transport !== server.transport) {
      updates.transport = formState.transport;
    }
    if (formState.is_enabled !== server.is_enabled) {
      updates.is_enabled = formState.is_enabled;
    }
    if (canEditIdentity) {
      const nextName = formState.name.trim();
      if (nextName !== server.name) {
        updates.name = nextName;
      }

      const nextDescription = normalizeDescription(formState.description);
      const currentDescription = normalizeDescription(server.description);
      if (nextDescription !== currentDescription) {
        updates.description = nextDescription;
      }
    }

    if (Object.keys(updates).length === 0) {
      setSaveSuccess("No changes to save.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(server.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            server?: McpServer;
            error?: {
              message?: string;
              details?: string[];
            };
          }
        | null;

      if (!response.ok) {
        setSaveError(parseApiError(payload, "Failed to save server settings."));
        return;
      }

      if (!payload?.server) {
        setSaveError("Server settings were saved but the response payload was invalid.");
        return;
      }

      onServerUpdated?.(payload.server);
      setFormState(createFormState(payload.server));
      setFormErrors({});
      setSaveError(null);
      setSaveSuccess("Server settings saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save server settings.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto pr-1">
      <form className="space-y-4" onSubmit={handleSave}>
        <div className="rounded-lg border bg-background p-3">
          <h3 className="text-sm font-medium">Server identity</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            URL and provider metadata are immutable in this panel.
          </p>
          <div className="mt-3 rounded-md border bg-muted/40 p-2 text-xs">
            <p className="text-muted-foreground">MCP URL</p>
            <code className="mt-1 block break-all text-foreground">{server.mcp_url}</code>
          </div>
        </div>

        <div className="rounded-lg border bg-background p-3">
          <h3 className="text-sm font-medium">Editable settings</h3>
          {!canEditIdentity ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Pre-configured server metadata is read-only. Only transport and enabled state can be changed.
            </p>
          ) : null}

          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="server-settings-name">Display name</Label>
              <Input
                id="server-settings-name"
                value={formState.name}
                onChange={(event) => {
                  setFormState((previous) => ({ ...previous, name: event.target.value }));
                  setFormErrors((previous) => ({ ...previous, name: undefined }));
                }}
                disabled={isSaving || !canEditIdentity}
                aria-invalid={Boolean(formErrors.name)}
              />
              {formErrors.name ? <p className="text-xs text-destructive">{formErrors.name}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="server-settings-description">Description</Label>
              <Textarea
                id="server-settings-description"
                value={formState.description}
                onChange={(event) =>
                  setFormState((previous) => ({ ...previous, description: event.target.value }))
                }
                disabled={isSaving || !canEditIdentity}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="server-settings-transport">Transport preference</Label>
              <select
                id="server-settings-transport"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={formState.transport}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    transport: event.target.value as McpServer["transport"],
                  }))
                }
                disabled={isSaving}
              >
                <option value="auto">Auto (try streamable HTTP, then SSE)</option>
                <option value="streamable_http">Streamable HTTP</option>
                <option value="sse">Server-sent events (SSE)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="server-settings-enabled">Enabled</Label>
              <label
                htmlFor="server-settings-enabled"
                className="flex items-center gap-2 rounded-md border p-2 text-sm"
              >
                <input
                  id="server-settings-enabled"
                  type="checkbox"
                  checked={formState.is_enabled}
                  onChange={(event) =>
                    setFormState((previous) => ({ ...previous, is_enabled: event.target.checked }))
                  }
                  disabled={isSaving}
                />
                Allow this server to appear in active workflows
              </label>
              <p className="text-xs text-muted-foreground">
                Disabled servers remain listed and can be re-enabled later from this tab.
              </p>
            </div>
          </div>
        </div>

        {dirty ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900">
            You have unsaved changes.
          </div>
        ) : null}
        {saveError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {saveError}
          </div>
        ) : null}
        {saveSuccess ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900">
            {saveSuccess}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={isSaving || !dirty}>
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving settings...
              </>
            ) : (
              "Save settings"
            )}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleCancel} disabled={isSaving || !dirty}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
