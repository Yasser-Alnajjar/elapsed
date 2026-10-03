import Link from "next/link";
import {
  ChevronRight,
  FileArchive,
  Webhook as WebhookIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONCIERGE_PROVIDER_COPY } from "@/lib/concierge-providers";
import type { ConciergeSourceProvider } from "@/lib/types/concierge-export";
import type { IntegrationProvider } from "@/lib/types/integrations";
import { WebhookInfo } from "../../integrations/csr/WebhookInfo";
import {
  BadgeDot,
  descriptionClass,
  SectionBadge,
  SectionCard,
} from "./detail-primitives";

/** Link to the Concierge CSV export for a webhook-capable source. */
export function ConciergeExportSection({
  provider,
  label,
}: {
  provider: IntegrationProvider;
  label: string;
}) {
  return (
    <SectionCard
      icon={<FileArchive className="size-4" />}
      title="Concierge export"
      description={`${label} data for the Concierge SLA analysis`}
    >
      <div className="bg-surface-container flex flex-wrap items-center justify-between gap-3 rounded-lg p-4">
        <p className={descriptionClass}>
          {provider === "jira"
            ? "Download issues and their status history from Jira's changelog as CSVs."
            : "Download tickets and their status changes from Zendesk's ticket audits as CSVs."}
        </p>
        <Button variant="surface" size="sm" className="text-nowrap" asChild>
          <Link
            href={
              CONCIERGE_PROVIDER_COPY[provider as ConciergeSourceProvider]
                .exportHref
            }
          >
            Open export
            <ChevronRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </SectionCard>
  );
}

/** Webhook endpoint and signing secret, with whether the gateway is listening. */
export function WebhooksSection({
  provider,
  integrationId,
  webhookSecret,
}: {
  provider: IntegrationProvider;
  integrationId: string;
  webhookSecret: string | null;
}) {
  return (
    <SectionCard
      icon={<WebhookIcon className="size-4" />}
      title="Real-time webhooks & ingress gateway"
      description="Close the gap between polls"
      badge={
        <SectionBadge tone={webhookSecret ? "success" : "warning"}>
          <BadgeDot
            tone={webhookSecret ? "success" : "warning"}
            pulse={!!webhookSecret}
          />
          {webhookSecret ? "Active listening" : "Unavailable"}
        </SectionBadge>
      }
    >
      <WebhookInfo
        provider={provider}
        integrationId={integrationId}
        webhookSecret={webhookSecret}
      />
    </SectionCard>
  );
}
