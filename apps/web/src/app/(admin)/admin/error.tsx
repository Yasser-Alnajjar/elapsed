"use client";

import { Activity, Check, Copy, RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { formatUtcTimestamp } from "@/lib/admin-format";

/**
 * The admin area's error boundary. Shows when it happened and the reference id
 * to quote (it matches the server log and Sentry), never the error's own text:
 * that can carry internals and does not help the operator decide anything.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [occurredAt, setOccurredAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOccurredAt(new Date().toISOString());
  }, []);

  async function copyReference() {
    if (!error.digest) return;
    try {
      await navigator.clipboard.writeText(error.digest);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the id is on screen to select by hand.
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-10">
      <AdminPanel tone="danger" className="flex flex-col gap-5 p-6">
        <div className="flex items-start gap-4">
          <span className="border-error/35 bg-error/10 text-error flex size-11 shrink-0 items-center justify-center rounded border">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <div>
            <MonoLabel className="text-error">Admin console fault</MonoLabel>
            <h1 className="text-foreground mt-0.5 text-2xl font-semibold tracking-tight">This page couldn&apos;t load</h1>
            <p className="text-muted-foreground mt-1 text-sm leading-5">
              Something went wrong while loading this admin page. Nothing was changed. Try again; if it keeps failing, quote the reference below.
            </p>
          </div>
        </div>

        <dl className="bg-background border-border grid gap-4 rounded border p-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <dt>
              <MonoLabel>Reference id</MonoLabel>
            </dt>
            <dd className="flex items-center justify-between gap-2">
              <span className="text-error min-w-0 truncate font-mono text-sm font-semibold">{error.digest ?? "Not available"}</span>
              {error.digest && (
                <button
                  type="button"
                  onClick={() => void copyReference()}
                  aria-label="Copy reference id"
                  className="text-foreground-subtle hover:text-foreground shrink-0"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </button>
              )}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt>
              <MonoLabel>Occurred</MonoLabel>
            </dt>
            <dd className="text-foreground font-mono text-sm tabular-nums">{occurredAt ? formatUtcTimestamp(occurredAt) : "—"}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={reset} className="font-mono text-xs">
            <RotateCw />
            Try again
          </Button>
          <Button asChild variant="outline" className="font-mono text-xs">
            <Link href="/admin/monitoring">
              <Activity />
              View monitoring
            </Link>
          </Button>
        </div>
      </AdminPanel>
    </div>
  );
}
