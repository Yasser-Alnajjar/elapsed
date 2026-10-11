"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";

/** Permanently deletes a disconnected source's configuration. Distinct from Disconnect, which keeps it. Cases, SLAs, events and history are kept. */
export function DeleteConfigurationDialog({
  variant = "button",
}: {
  variant?: "button" | "link";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const result = await Actions.CustomProvider.deleteConfiguration();
    setBusy(false);
    if (!result.ok) {
      notify.error("The configuration could not be deleted.");
      return;
    }
    setOpen(false);
    notify.success("Custom REST configuration deleted.");
    router.refresh();
  }

  return (
    <AlertDialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
      <AlertDialogTrigger asChild>
        {variant === "link" ? (
          <Button
            type="button"
            variant="link"
            className="text-error h-auto self-start p-0 text-xs font-normal underline-offset-2 hover:underline"
          >
            Delete configuration
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="shrink-0"
          >
            Delete configuration
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete the Custom REST configuration?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the draft and every configuration version,
            so you set it up again from scratch. Your cases, SLAs, events and
            history are not deleted; they stay hidden until you connect the
            source again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {busy ? "Deleting..." : "Delete configuration"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
