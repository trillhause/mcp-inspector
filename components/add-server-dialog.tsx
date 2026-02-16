"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { McpServer } from "@/lib/types";

type AddServerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServerCreated: (server: McpServer) => void;
};

type AddServerFormState = {
  name: string;
  mcp_url: string;
  description: string;
  transport: McpServer["transport"];
};

type AddServerFormErrors = Partial<Record<keyof AddServerFormState, string>>;

type UrlValidationResult =
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | { kind: "valid"; canonicalUrl: string };

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const INITIAL_FORM_STATE: AddServerFormState = {
  name: "",
  mcp_url: "",
  description: "",
  transport: "auto",
};

function normalizePathname(pathname: string) {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  if (withoutTrailingSlash.length === 0 || withoutTrailingSlash === "/") {
    return "/mcp";
  }
  return withoutTrailingSlash.startsWith("/") ? withoutTrailingSlash : `/${withoutTrailingSlash}`;
}

function isAllowedHttpHostname(hostname: string) {
  if (LOCALHOST_HOSTNAMES.has(hostname)) {
    return true;
  }
  return hostname.endsWith(".localhost");
}

function validateMcpUrlInput(input: string): UrlValidationResult {
  const rawValue = input.trim();
  if (!rawValue) {
    return { kind: "empty" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawValue);
  } catch {
    return { kind: "invalid", message: "MCP URL must be a valid absolute URL." };
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    return { kind: "invalid", message: "MCP URL must use https:// (or http:// for localhost)." };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (protocol === "http:" && !isAllowedHttpHostname(hostname)) {
    return { kind: "invalid", message: "MCP URL must use https:// for non-localhost URLs." };
  }

  const canonicalUrl = `${parsedUrl.origin}${normalizePathname(parsedUrl.pathname)}`;
  return {
    kind: "valid",
    canonicalUrl,
  };
}

function validateForm(formState: AddServerFormState) {
  const errors: AddServerFormErrors = {};

  if (!formState.name.trim()) {
    errors.name = "Server name is required.";
  }

  const mcpUrlValidation = validateMcpUrlInput(formState.mcp_url);
  if (mcpUrlValidation.kind === "empty") {
    errors.mcp_url = "MCP URL is required.";
  } else if (mcpUrlValidation.kind === "invalid") {
    errors.mcp_url = mcpUrlValidation.message;
  }

  return {
    errors,
    canonicalUrl: mcpUrlValidation.kind === "valid" ? mcpUrlValidation.canonicalUrl : null,
  };
}

function parseApiError(
  payload: unknown,
  fallbackMessage: string,
) {
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

export function AddServerDialog({
  open,
  onOpenChange,
  onServerCreated,
}: AddServerDialogProps) {
  const [formState, setFormState] = useState<AddServerFormState>(INITIAL_FORM_STATE);
  const [formErrors, setFormErrors] = useState<AddServerFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const urlValidation = useMemo(
    () => validateMcpUrlInput(formState.mcp_url),
    [formState.mcp_url],
  );

  const normalizedUrlPreview = urlValidation.kind === "valid" ? urlValidation.canonicalUrl : null;

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }

    onOpenChange(false);
    setFormState(INITIAL_FORM_STATE);
    setFormErrors({});
    setSubmitError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const validation = validateForm(formState);
    if (Object.keys(validation.errors).length > 0 || !validation.canonicalUrl) {
      setFormErrors(validation.errors);
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formState.name.trim(),
          mcp_url: validation.canonicalUrl,
          description: formState.description.trim() || null,
          transport: formState.transport,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        server?: McpServer;
        error?: { message?: string; details?: string[] };
      } | null;

      if (!response.ok) {
        setSubmitError(parseApiError(payload, "Failed to create server."));
        return;
      }

      if (!payload?.server) {
        setSubmitError("Server was created but the response payload was invalid.");
        return;
      }

      onServerCreated(payload.server);
      onOpenChange(false);
      setFormState(INITIAL_FORM_STATE);
      setFormErrors({});
      setSubmitError(null);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to create server.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : handleClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Custom Server</DialogTitle>
          <DialogDescription>
            Connect another MCP endpoint by name and URL.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="add-server-name">Name</Label>
            <Input
              id="add-server-name"
              name="name"
              value={formState.name}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Acme MCP"
              aria-invalid={Boolean(formErrors.name)}
              disabled={isSubmitting}
              required
            />
            {formErrors.name ? (
              <p className="text-sm text-destructive">{formErrors.name}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-server-url">MCP URL</Label>
            <Input
              id="add-server-url"
              name="mcp_url"
              value={formState.mcp_url}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, mcp_url: event.target.value }))
              }
              placeholder="https://mcp.notion.com"
              aria-invalid={Boolean(formErrors.mcp_url)}
              disabled={isSubmitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              Use either a base URL (`https://mcp.notion.com`) or an explicit endpoint (`https://mcp.notion.com/mcp`).
            </p>
            {normalizedUrlPreview ? (
              <p className="text-xs text-muted-foreground">
                Stored as:{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                  {normalizedUrlPreview}
                </code>
              </p>
            ) : null}
            {formErrors.mcp_url ? (
              <p className="text-sm text-destructive">{formErrors.mcp_url}</p>
            ) : urlValidation.kind === "invalid" ? (
              <p className="text-sm text-muted-foreground">{urlValidation.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-server-description">Description (optional)</Label>
            <Textarea
              id="add-server-description"
              name="description"
              value={formState.description}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="What this MCP server is used for"
              disabled={isSubmitting}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-server-transport">Transport (optional)</Label>
            <select
              id="add-server-transport"
              name="transport"
              value={formState.transport}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  transport: event.target.value as McpServer["transport"],
                }))
              }
              className="border-input bg-background focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none focus-visible:ring-[3px]"
              disabled={isSubmitting}
            >
              <option value="auto">Auto (recommended)</option>
              <option value="streamable_http">Streamable HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </div>

          {submitError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {submitError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Add Server"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
