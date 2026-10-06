"use client";

import type {
  IntegrationConfigStatus,
  IntegrationConnectionView,
} from "@/lib/types/integrations";
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
  delay,
}: {
  spec: SourceIntegrationSpec;
  view: IntegrationConnectionView;
  config: IntegrationConfigStatus;
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
      badge={spec.badge}
      status={
        <ProviderConnectionStatus
          view={view}
          config={config}
          providerLabel={label}
        />
      }
    >
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
            <Connect />
          </ConnectPrompt>
        )}
      </IntegrationConfigGate>
    </IntegrationCardShell>
  );
}
