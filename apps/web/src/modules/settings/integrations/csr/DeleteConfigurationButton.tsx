"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import { Actions } from "@/actions/client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ConfigurableIntegrationProvider } from "@/lib/types/integrations";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

interface DeleteConfigurationButtonProps {
  provider: ConfigurableIntegrationProvider;
  providerLabel: string;
  /** Called once the configuration is gone — the caller refreshes whatever state still shows it as configured. */
  onDeleted: () => void;
}

/**
 * Permanently deletes a provider's saved OAuth app configuration. Distinct
 * from `DisconnectButton`, which keeps the configuration so the integration
 * can be reconnected: after this, the provider is back to its unconfigured
 * state and has to be configured from scratch. Only offered while the
 * integration is not connected — a connected one is disconnected first.
 */
export function DeleteConfigurationButton({
  provider,
  providerLabel,
  onDeleted,
}: DeleteConfigurationButtonProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);

    const result = await Actions.Integrations.deleteIntegrationConfig(provider);

    if (!result.ok) {
      setError(result.error);
      setDeleting(false);
      return;
    }

    setDeleting(false);
    setOpen(false);
    onDeleted();
  }

  function handleOpenChange(value: boolean) {
    if (deleting) return;

    setOpen(value);

    if (!value) {
      setError(null);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="link"
          className="h-auto self-start p-0 text-xs font-normal text-error underline-offset-2 hover:underline"
        >
          Delete configuration
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {providerLabel} configuration?
          </AlertDialogTitle>

          <AlertDialogDescription>
            This permanently removes the saved {providerLabel} OAuth app
            credentials. To use {providerLabel} again you&apos;ll need to
            configure it from scratch. Existing cases and history will remain
            unchanged.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>

          <AlertDialogAction
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
            disabled={deleting}
          >
            {deleting && <Loader2 className="animate-spin" />}
            {deleting ? "Deleting..." : "Delete configuration"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
