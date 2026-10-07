"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { IntegrationProvider } from "@/lib/types/integrations";
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

interface DisconnectButtonProps {
  provider: IntegrationProvider | "slack";
  providerLabel: string;
}

export function DisconnectButton({
  provider,
  providerLabel,
}: DisconnectButtonProps) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDisconnecting(true);
    setError(null);

    const result = await Actions.Integrations.disconnect(provider);

    if (!result.ok) {
      setError(result.error);
      setDisconnecting(false);
      return;
    }

    setDisconnecting(false);
    setOpen(false);
    router.refresh();
  }

  function handleOpenChange(value: boolean) {
    if (disconnecting) return;

    setOpen(value);

    if (!value) {
      setError(null);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="surface">
          Disconnect
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {providerLabel}?</AlertDialogTitle>

          <AlertDialogDescription>
            Stop syncing {providerLabel} and remove its access? Its cases and
            history are hidden while it is disconnected and return when you
            reconnect. Nothing is deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>

          <AlertDialogAction
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
            disabled={disconnecting}
          >
            {disconnecting && <Loader2 className="animate-spin" />}
            {disconnecting ? "Disconnecting..." : "Disconnect"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
