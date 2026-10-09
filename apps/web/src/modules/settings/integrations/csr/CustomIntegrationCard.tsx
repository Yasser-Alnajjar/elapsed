"use client";

import { Plug } from "lucide-react";
import Link from "next/link";
import { PausedByElapsedBanner } from "@/components/shared/integration-availability-notice";
import { Button } from "@/components/ui/button";
import { STATE_COPY } from "@/lib/custom-provider/state-copy";
import type { IntegrationConnectionView, IntegrationsPageData, ProviderAvailabilityView } from "@/lib/types/integrations";
import { IntegrationCardShell } from "./IntegrationCardShell";
import { ReleaseStageBadge } from "./ReleaseStageBadge";

/** The Custom REST entry on the integrations page. Shown only to organizations on its Beta allowlist, or that already have it connected. */
export function CustomIntegrationCard({
  view,
  state,
  availability,
  delay,
}: {
  view: IntegrationConnectionView;
  state: IntegrationsPageData["customState"];
  availability: ProviderAvailabilityView;
  delay: number;
}) {
  const copy = state ? STATE_COPY[state] : null;
  return (
    <IntegrationCardShell
      delay={delay}
      icon={<Plug className="size-4" />}
      connected={view.connected}
      title="Custom REST"
      subtitle="Any helpdesk with a read-only JSON API"
      tag="TICKETS"
      badge={<ReleaseStageBadge stage={availability.releaseStage} />}
    >
      <div className="flex flex-col gap-3 text-sm">
        {view.connected && !availability.available && <PausedByElapsedBanner providerLabel="Custom REST" availability={availability} />}
        {copy && (
          <p>
            <strong>{copy.title}.</strong> {state === "needs_attention" ? "Open the page for details." : copy.body}
          </p>
        )}
        {!view.connected && <p className="text-on-surface-variant">Read-only access: Elapsed only reads from your API, over HTTPS, and never writes anything back.</p>}
        <Button asChild size="sm" className="self-start">
          <Link href="/settings/integrations/custom">{view.connected ? "Manage" : "Set up"}</Link>
        </Button>
      </div>
    </IntegrationCardShell>
  );
}
