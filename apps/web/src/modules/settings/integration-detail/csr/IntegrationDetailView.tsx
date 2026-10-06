"use client";

import { Reveal } from "@/components/shared/reveal";
import {
  INTEGRATION_PROVIDER_LABELS,
  type IntegrationDetailData,
} from "@/lib/types/integrations";
import { BackfillSection } from "./BackfillSection";
import { ConnectionSummaryCard } from "./ConnectionSummaryCard";
import { GovernanceSection } from "./GovernanceSection";
import { IntegrationDetailHeader } from "./IntegrationDetailHeader";
import { SyncHealthSection } from "./SyncHealthSection";
import { ConciergeExportSection, WebhooksSection } from "./WebhookSections";

interface IntegrationDetailViewProps {
  data: IntegrationDetailData;
}

export function IntegrationDetailView({ data }: IntegrationDetailViewProps) {
  const { provider, subdomain, repo } = data;
  const label = INTEGRATION_PROVIDER_LABELS[provider];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <IntegrationDetailHeader
        provider={provider}
        label={label}
        integrationId={data.integrationId}
        connectedAt={data.connectedAt}
        disconnectedAt={data.disconnected ? data.disconnectedAt : null}
        reauthRequired={data.reauthRequired}
        permissionDenied={data.permissionDenied}
      />

      <Reveal delay={0.03}>
        <ConnectionSummaryCard data={data} label={label} />
      </Reveal>
      <Reveal delay={0.05}>
        <BackfillSection
          provider={provider}
          reauthRequired={data.reauthRequired}
          subdomain={subdomain}
          repo={repo}
          backfillCompletedAt={data.backfillCompletedAt}
          disconnected={data.disconnected}
        />
      </Reveal>
      <Reveal delay={0.1}>
        <SyncHealthSection data={data} label={label} />
      </Reveal>

      {data.webhooks && !data.disconnected && (
        <Reveal delay={0.15}>
          <ConciergeExportSection provider={provider} label={label} />
        </Reveal>
      )}

      {data.webhooks && !data.disconnected && (
        <Reveal delay={0.2}>
          <WebhooksSection
            provider={provider}
            integrationId={data.integrationId}
            webhookSecret={data.webhookSecret}
          />
        </Reveal>
      )}

      <Reveal delay={0.25}>
        <GovernanceSection
          provider={provider}
          label={label}
          subdomain={subdomain}
          repo={repo}
          disconnected={data.disconnected}
          importedData={data.importedData}
        />
      </Reveal>
    </div>
  );
}
