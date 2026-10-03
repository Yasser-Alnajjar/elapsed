"use client";

import { Copy, Link2 } from "lucide-react";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import type { IntegrationProvider } from "@/lib/types/integrations";

/**
 * N5.3 / D26: the person who administers the tracker is often not an Elapsed
 * member. An owner mints a single-use, expiring link for one provider and
 * forwards it; opening it lets that person finish this one OAuth grant without
 * an account.
 */
export function RequestTrackerAccess({ provider, label }: { provider: IntegrationProvider; label: string }) {
  const [intendedFor, setIntendedFor] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopyToClipboard();

  async function create() {
    setBusy(true);
    setError(null);
    const { ok, body } = await Actions.Integrations.createConnectLink(provider, intendedFor || undefined);
    setBusy(false);

    if (!ok || !body.url) {
      setError(body.error ?? "Could not create the link");
      return;
    }
    setUrl(body.url);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
      <div className="flex items-start gap-2">
        <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <p className="font-medium">Not the {label} admin?</p>
          <p className="text-muted-foreground">
            Send them a link. It works once, expires in 72 hours, grants read-only {label} access for this
            organization only, and needs no Elapsed account.
          </p>
        </div>
      </div>
      {url ? (
        <div className="flex gap-2">
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Connect link" />
          <Button
            type="button"
            variant="outline"
            onClick={() => copy(url)}
          >
            <Copy className="size-4" />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={intendedFor}
            maxLength={120}
            onChange={(e) => setIntendedFor(e.target.value)}
            placeholder="Who is it for? (optional, e.g. Dana, platform team)"
            aria-label="Who the link is for"
          />
          <Button type="button" variant="outline" disabled={busy} onClick={create}>
            Create link
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
