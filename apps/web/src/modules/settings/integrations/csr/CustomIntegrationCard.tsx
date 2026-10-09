"use client";

import { Plug } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATE_COPY } from "@/lib/custom-provider/state-copy";
import type { IntegrationConnectionView, IntegrationsPageData } from "@/lib/types/integrations";
import { IntegrationCardShell } from "./IntegrationCardShell";

/** The Custom REST entry on the integrations page. Shown only to organizations the operator enabled, or that already have it connected. */
export function CustomIntegrationCard({ view, state, delay }: { view: IntegrationConnectionView; state: IntegrationsPageData["customState"]; delay: number }) {
  const copy = state ? STATE_COPY[state] : null;
  return (
    <IntegrationCardShell
      delay={delay}
      icon={<Plug className="size-4" />}
      connected={view.connected}
      title="Custom REST"
      subtitle="Any helpdesk with a read-only JSON API"
      tag="TICKETS"
      badge={<Badge variant="beta">Beta</Badge>}
    >
      <div className="flex flex-col gap-3 text-sm">
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
