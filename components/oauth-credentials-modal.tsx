"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

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

type OAuthCredentialsModalProps = {
  serverId: string;
  serverName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCredentialsSaved: (serverId: string) => void;
};

export function OAuthCredentialsModal({
  serverId,
  serverName,
  open,
  onOpenChange,
  onCredentialsSaved,
}: OAuthCredentialsModalProps) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleClose = () => {
    if (isSubmitting) return;
    onOpenChange(false);
    setClientId("");
    setClientSecret("");
    setSubmitError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const trimmedClientId = clientId.trim();
    if (!trimmedClientId) {
      setSubmitError("Client ID is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oauth_client_id: trimmedClientId,
          oauth_client_secret: clientSecret.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string; details?: string[] };
      } | null;

      if (!response.ok) {
        const message = payload?.error?.details?.[0] ?? payload?.error?.message ?? "Failed to save credentials.";
        setSubmitError(message);
        return;
      }

      setClientId("");
      setClientSecret("");
      setSubmitError(null);
      onOpenChange(false);
      onCredentialsSaved(serverId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to save credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : handleClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>OAuth Credentials Required</DialogTitle>
          <DialogDescription>
            <strong>{serverName}</strong> does not support automatic client registration.
            Register an OAuth app with the provider and enter the credentials below.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="oauth-client-id">Client ID</Label>
            <Input
              id="oauth-client-id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="Enter your OAuth Client ID"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="oauth-client-secret">Client Secret (optional)</Label>
            <Input
              id="oauth-client-secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder="Enter your OAuth Client Secret"
              disabled={isSubmitting}
            />
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
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save & Connect"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
