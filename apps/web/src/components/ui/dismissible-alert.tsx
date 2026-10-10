"use client";

import { X } from "lucide-react";
import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type DismissibleAlertProps = React.ComponentProps<typeof Alert> & {
  /** Called after the alert is hidden. Dismissing only hides the message; it never changes application state. */
  onDismiss?: () => void;
  /** Accessible name for the close button. */
  dismissLabel?: string;
};

/**
 * An `<Alert>` with a close button at its end edge (logical `ms-auto`, so it
 * mirrors under RTL). Use for persistent page-state messages that the user may
 * set aside. The message reappears on the next page load while the underlying
 * condition still holds.
 */
export function DismissibleAlert({
  children,
  onDismiss,
  dismissLabel = "Dismiss",
  className,
  ...props
}: DismissibleAlertProps) {
  const [open, setOpen] = React.useState(true);
  if (!open) return null;
  return (
    <Alert className={className} {...props}>
      {children}
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => {
          setOpen(false);
          onDismiss?.();
        }}
        className={cn(
          "ms-auto -me-1 -mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md opacity-70",
          "transition-opacity hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <X className="size-4" aria-hidden />
      </button>
    </Alert>
  );
}
