"use client";

import { PausedByElapsedBanner } from "@/components/shared/integration-availability-notice";
import type {
  IntegrationConfigStatus,
  IntegrationConnectionView,
  ProviderAvailabilityView,
} from "@/lib/types/integrations";
import { ReleaseStageBadge } from "./ReleaseStageBadge";
import { ConnectedCardBody } from "./ConnectedCardBody";
import { ConnectPrompt } from "./ConnectPrompt";
import { IntegrationCardShell } from "./IntegrationCardShell";
import { IntegrationConfigGate } from "./IntegrationConfigGate";
import { ProviderConnectionStatus } from "./IntegrationStatus";
import { descriptionClass } from "./card-format";
import type { SourceIntegrationSpec } from "./source-integration-specs";

const metaChip =
  "text-primary bg-surface-container-lowest border-outline-variant/30 rounded border px-1.5 py-0.5 font-mono text-xxs";
const metaDot = <span className="text-outline">·</span>;

/** A ticket or engineering source's card: configure → connect → connected, driven by its spec. */
export function SourceIntegrationCard({
  spec,
  view,
  config,
  availability,
  delay,
}: {
  spec: SourceIntegrationSpec;
  view: IntegrationConnectionView;
  config: IntegrationConfigStatus;
  /** Platform availability (D33): the stage badge, and whether it can be connected or is paused by Elapsed. */
  availability: ProviderAvailabilityView;
  delay: number;
}) {
  const { provider, label, Connect } = spec;

  return (
    <IntegrationCardShell
      delay={delay}
      icon={spec.icon}
      connected={view.connected}
      title={label}
      subtitle={spec.subtitle}
      tag={spec.tag}
      badge={<ReleaseStageBadge stage={availability.releaseStage} />}
      status={
        <ProviderConnectionStatus
          view={view}
          config={config}
          providerLabel={label}
        />
      }
    >
      {view.connected && !availability.available && <PausedByElapsedBanner providerLabel={label} availability={availability} />}
      <IntegrationConfigGate
        provider={provider}
        providerLabel={label}
        config={config}
        connected={view.connected}
        descriptionClass={descriptionClass}
        helpUrl={spec.help.url}
        helpLabel={spec.help.label}
      >
        {view.connected ? (
          <ConnectedCardBody
            provider={provider}
            pollingPaused={view.pollingPaused}
            providerLabel={label}
            connectedAt={view.connectedAt!}
            meta={
              <>
                {metaDot}
                <span className={metaChip}>{spec.address(view.subdomain)}</span>
                {metaDot}
                <span className={spec.detail.className}>{spec.detail.text}</span>
              </>
            }
            pulse={spec.pulse}
          />
        ) : (
          <ConnectPrompt
            description={spec.connectDescription}
            disconnectedAt={view.disconnectedAt}
          >
            {availability.available ? (
              <Connect />
            ) : (
              // D33: no connect control while the provider is unavailable; the backend refuses it anyway.
              <p className="text-on-surface-variant text-sm" data-testid="provider-unavailable">
                {availability.message}
                {availability.statusMessage ? ` ${availability.statusMessage}` : ""}
              </p>
            )}
          </ConnectPrompt>
        )}
      </IntegrationConfigGate>
    </IntegrationCardShell>
  );
}
