"use client";

import { AlertCircle, Info, Loader2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { ReauthBanner } from "@/components/shared/reauth-banner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ZendeskSyncResult } from "@/lib/types/integrations";

export function ZendeskConnectForm() {
  const [subdomain, setSubdomain] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    window.location.href = `/api/integrations/zendesk/connect?subdomain=${encodeURIComponent(subdomain)}`;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Label
        htmlFor="zendesk-subdomain"
        className="font-label-caps text-label-caps uppercase tracking-wider text-on-surface-variant"
      >
        Support domain configuration
      </Label>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row">
        <div className="relative flex flex-1 items-center">
          <input
            id="zendesk-subdomain"
            value={subdomain}
            onChange={(event) => setSubdomain(event.target.value)}
            placeholder="your-subdomain"
            pattern="[a-zA-Z0-9][a-zA-Z0-9\-]*"
            required
            className="font-mono-metric-md text-mono-metric-md w-full rounded-lg bg-surface-container-lowest px-4 py-3 pe-32 text-on-surface transition-colors placeholder:text-on-surface-variant/60 focus:bg-surface-container-high focus:outline-none"
          />
          <span className="font-code-audit text-code-audit pointer-events-none absolute inset-e-4 text-on-surface-variant/60">
            .zendesk.com
          </span>
        </div>
        <Button
          type="submit"
          className="gap-1.5 rounded-lg px-5 py-3 font-semibold shadow-md"
        >
          <Zap className="size-5" />
          Connect Zendesk
        </Button>
      </div>
      <p className="font-code-audit text-code-audit flex items-center gap-1.5 text-on-surface-variant/70">
        <Info className="size-3.5 shrink-0" />
        Standard OAuth redirect happens inside Zendesk&apos;s own
        authorization screen.
      </p>
    </form>
  );
}

interface ZendeskBackfillButtonProps {
  /** Needed to send the user back through /connect without retyping it. */
  subdomain: string;
  /** True when the stored credentials already carry `reauthRequired` (checked on the server before this renders). */
  initialReauthRequired?: boolean;
}

export function ZendeskBackfillButton({
  subdomain,
  initialReauthRequired = false,
}: ZendeskBackfillButtonProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ZendeskSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(initialReauthRequired);

  async function handleClick() {
    setRunning(true);
    setError(null);
    setResult(null);

    const { ok, body } = await Actions.Integrations.runZendeskBackfill();
    setRunning(false);

    if (!ok) {
      if (body.reauthRequired) {
        setReauthRequired(true);
      } else {
        setError(body.error ?? "Backfill failed");
      }
      return;
    }

    setResult(body);
    router.refresh();
  }

  if (reauthRequired) {
    return (
      <ReauthBanner
        provider="Zendesk"
        reconnectHref={`/api/integrations/zendesk/connect?subdomain=${encodeURIComponent(subdomain)}`}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-3">
      <Button
        type="button"
        size="sm"
        variant="surface"
        onClick={handleClick}
        disabled={running}
      >
        {running && <Loader2 className="animate-spin" />}
        {running ? "Running backfill…" : "Run backfill"}
      </Button>

      {error && (
        <Alert variant="destructive" className="w-full max-w-full">
          <AlertCircle />
          <AlertDescription className="min-w-0 wrap-break-word">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="w-full min-w-0 space-y-1 text-sm text-on-surface-variant">
          <p className="wrap-break-word">
            {result.backfill.ticketsFetched} tickets ·{" "}
            {result.backfill.ticketAuditsFetched} ticket events ·{" "}
            {result.backfill.organizationsFetched} organizations ·{" "}
            {result.backfill.slaPoliciesFetched} SLA policies.
          </p>

          <p className="wrap-break-word">
            {result.normalization.casesUpserted} cases ·{" "}
            {result.normalization.customersUpserted} customers ·{" "}
            {result.normalization.eventsDerived} normalized events.
            {result.normalization.failures.length > 0 &&
              ` ${result.normalization.failures.length} ticket(s) failed to normalize.`}
          </p>
        </div>
      )}
    </div>
  );
}
