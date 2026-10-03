"use client";

import { Info, Zap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BackfillButton } from "./BackfillButton";

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
  initialReauthRequired?: boolean;
}

export function ZendeskBackfillButton({ subdomain, initialReauthRequired = false }: ZendeskBackfillButtonProps) {
  return (
    <BackfillButton
      provider="Zendesk"
      reconnectHref={`/api/integrations/zendesk/connect?subdomain=${encodeURIComponent(subdomain)}`}
      initialReauthRequired={initialReauthRequired}
      run={Actions.Integrations.runZendeskBackfill}
      renderResult={({ backfill, normalization }) => (
        <>
          <p className="wrap-break-word">
            {backfill.ticketsFetched} tickets · {backfill.ticketAuditsFetched} ticket events ·{" "}
            {backfill.organizationsFetched} organizations · {backfill.slaPoliciesFetched} SLA policies.
          </p>
          <p className="wrap-break-word">
            {normalization.casesUpserted} cases · {normalization.customersUpserted} customers ·{" "}
            {normalization.eventsDerived} normalized events.
            {normalization.failures.length > 0 &&
              ` ${normalization.failures.length} ticket(s) failed to normalize.`}
          </p>
        </>
      )}
    />
  );
}
