"use client";

import { Plug } from "lucide-react";
import Link from "next/link";
import { DeleteConfigurationDialog } from "@modules/settings/custom-provider/csr/DeleteConfigurationDialog";
import { PausedByElapsedBanner } from "@/components/shared/integration-availability-notice";
import { Button } from "@/components/ui/button";
import { STATE_COPY } from "@/lib/custom-provider/state-copy";
import type {
  IntegrationConnectionView,
  IntegrationsPageData,
  ProviderAvailabilityView,
} from "@/lib/types/integrations";
import { ConnectedCardBody } from "./ConnectedCardBody";
import { ConnectPrompt } from "./ConnectPrompt";
import { IntegrationCardShell } from "./IntegrationCardShell";
import { StatusIndicator } from "./IntegrationStatus";
import { ReleaseStageBadge } from "./ReleaseStageBadge";

const metaChip =
  "text-primary bg-surface-container-lowest border-outline-variant/30 rounded border px-1.5 py-0.5 font-mono text-xxs";
const metaDot = <span className="text-outline">·</span>;

/** The card's status pill: the connection health, or "Disconnected" once it has been connected before. */
function CustomStatus({
  view,
  state,
}: {
  view: IntegrationConnectionView;
  state: IntegrationsPageData["customState"];
}) {
  if (view.connected) {
    if (view.reauthRequired)
      return <StatusIndicator tone="warning" label="Needs reconnect" />;
    if (state === "needs_attention")
      return <StatusIndicator tone="warning" label="Needs attention" />;
    return <StatusIndicator tone="success" label="Connected" />;
  }
  if (view.disconnectedAt)
    return <StatusIndicator tone="muted" label="Disconnected" />;
  return null;
}

/** The Custom REST entry on the integrations page, built like the other ticket sources. Shown only to organizations on its Beta allowlist, or that already have it connected. */
export function CustomIntegrationCard({
  view,
  state,
  hasConfiguration,
  availability,
  delay,
}: {
  view: IntegrationConnectionView;
  state: IntegrationsPageData["customState"];
  /** Saved configuration versions exist: Disconnect keeps them, so the card offers Connect and Delete configuration. Without them it offers Set up. */
  hasConfiguration: boolean;
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
      status={<CustomStatus view={view} state={state} />}
    >
      {view.connected && !availability.available && (
        <PausedByElapsedBanner
          providerLabel="Custom REST"
          availability={availability}
        />
      )}
      {view.connected ? (
        <ConnectedCardBody
          provider="custom"
          providerLabel="Custom REST"
          connectedAt={view.connectedAt!}
          pollingPaused={view.pollingPaused}
          meta={
            <>
              {metaDot}
              <span className={metaChip}>REST · JSON</span>
              {metaDot}
              <span className="font-mono text-xxs uppercase">Read-only</span>
            </>
          }
          disconnectHint={
            copy
              ? `${copy.title}. ${state === "needs_attention" ? "Open the page for details." : copy.body}`
              : undefined
          }
        />
      ) : (
        <ConnectPrompt
          description="Read-only access: Elapsed only reads from your API, over HTTPS, and never writes anything back."
          disconnectedAt={view.disconnectedAt}
        >
          {availability.available ? (
            <Button size="sm" asChild>
              <Link href="/settings/integrations/custom">
                {hasConfiguration
                  ? "Connect Custom REST"
                  : "Set up Custom REST"}
              </Link>
            </Button>
          ) : (
            <p
              className="text-on-surface-variant text-sm"
              data-testid="provider-unavailable"
            >
              {availability.message}
              {availability.statusMessage
                ? ` ${availability.statusMessage}`
                : ""}
            </p>
          )}
          {hasConfiguration && (
            <div className="mt-3">
              <DeleteConfigurationDialog variant="link" />
            </div>
          )}
        </ConnectPrompt>
      )}
    </IntegrationCardShell>
  );
}
