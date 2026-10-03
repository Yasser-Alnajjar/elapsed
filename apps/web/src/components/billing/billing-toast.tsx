"use client";

import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface BillingToastMessage {
  title: string;
  description: string;
  /** `preview`: informational, nothing changed. `error`: the action was refused. */
  tone?: "success" | "preview" | "error";
}

const DISMISS_AFTER_MS = 5000;

/** One toast at a time: `show` replaces the current message. */
export function useBillingToast() {
  const [message, setMessage] = useState<BillingToastMessage | null>(null);
  const show = useCallback((next: BillingToastMessage) => setMessage(next), []);
  const dismiss = useCallback(() => setMessage(null), []);
  return { message, show, dismiss };
}

/**
 * The bottom-right confirmation from the Stitch billing designs. Announced to
 * screen readers through a polite live region; dismisses itself.
 */
export function BillingToast({
  message,
  onDismiss,
}: {
  message: BillingToastMessage | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  const tone = message?.tone ?? "preview";
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? CircleAlert : Info;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-end sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      {message && (
        <div className="bg-popover border-border shadow-elevated pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3">
          <Icon
            aria-hidden
            className={cn(
              "mt-0.5 size-5 shrink-0",
              tone === "success" ? "text-success" : tone === "error" ? "text-error" : "text-primary",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-foreground font-mono text-xs font-bold">
              {message.title}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-4">
              {message.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-foreground-subtle hover:text-foreground -mr-1 rounded p-0.5"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
