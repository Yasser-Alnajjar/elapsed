"use client";

import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IntegrationDataCounts } from "@/lib/types/data";
import type { IntegrationProvider } from "@/lib/types/integrations";
import { DataCountsList } from "./DataCountsList";
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

interface CleanupDataButtonProps {
  provider: IntegrationProvider;
  providerLabel: string;
  /** What is stored, shown in the confirmation so the user sees the actual scope. */
  counts: IntegrationDataCounts;
  /** Cleanup is only offered for a disconnected integration. */
  disabled: boolean;
  /** Why it is disabled, shown on hover where the surrounding text does not already say. */
  disabledReason?: string;
}

/**
 * Permanently deletes the data a disconnected integration imported. Distinct
 * from `DisconnectButton`, which never deletes anything: this only ever runs
 * from its own explicit confirmation, and the user must type the provider's
 * name before the destructive action is enabled. The integration itself stays,
 * still disconnected.
 */
export function CleanupDataButton({
  provider,
  providerLabel,
  counts,
  disabled,
  disabledReason,
}: CleanupDataButtonProps) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed =
    confirmation.trim().toLowerCase() === providerLabel.toLowerCase();

  async function handleConfirm() {
    setCleaning(true);
    setError(null);

    const result = await Actions.Integrations.cleanupData(provider);

    if (!result.ok) {
      setError(result.error);
      setCleaning(false);
      return;
    }

    setCleaning(false);
    setOpen(false);
    setConfirmation("");
    router.refresh();
  }

  function handleOpenChange(value: boolean) {
    if (cleaning) return;

    setOpen(value);

    if (!value) {
      setError(null);
      setConfirmation("");
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <span title={disabled ? disabledReason : undefined}>
        <AlertDialogTrigger asChild>
          <Button type="button" size="sm" variant="surface" disabled={disabled}>
            <Trash2 className="size-3.5" />
            Clean up data
          </Button>
        </AlertDialogTrigger>
      </span>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Permanently delete {providerLabel} data?
          </AlertDialogTitle>

          <AlertDialogDescription>
            This permanently removes the data imported from {providerLabel}.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <DataCountsList counts={counts} />

        <p className="text-xs text-on-surface-variant">
          Data from other integrations, your SLA policies and calendars are not
          deleted, and {providerLabel} stays disconnected. Reconnecting later
          imports it again from scratch. Cleaning up does not create a backup
          — download one first if you need a copy.
        </p>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`cleanup-confirm-${provider}`}>
            Type {providerLabel} to confirm
          </Label>
          <Input
            id={`cleanup-confirm-${provider}`}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={providerLabel}
            autoComplete="off"
            disabled={cleaning}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={cleaning}>Cancel</AlertDialogCancel>

          <AlertDialogAction
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
            disabled={!confirmed || cleaning}
          >
            {cleaning && <Loader2 className="animate-spin" />}
            {cleaning ? "Deleting..." : "Delete imported data"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
