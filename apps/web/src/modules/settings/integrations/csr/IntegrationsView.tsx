"use client";

import Link from "next/link";
import { ArrowRight, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IntegrationsPageData } from "@/lib/types/integrations";
import { IntegrationsHeader } from "./IntegrationsHeader";
import { IntegrationsMetrics } from "./IntegrationsMetrics";
import { SecurityPrinciples } from "./SecurityPrinciples";
import { SlackIntegrationCard } from "./SlackIntegrationCard";
import { SourceIntegrationCard } from "./SourceIntegrationCard";
import { SOURCE_INTEGRATION_SPECS } from "./source-integration-specs";

interface IntegrationsViewProps {
  data: IntegrationsPageData;
}

const CARD_STAGGER = 0.05;

export const IntegrationsView = ({ data }: IntegrationsViewProps) => {
  const connectedCount = [
    data.zendesk,
    data.jira,
    data.linear,
    data.intercom,
    data.github,
    data.slack,
  ].filter((v) => v.connected).length;

  return (
    <div className="space-y-6">
      <IntegrationsHeader connectedCount={connectedCount} />

      <IntegrationsMetrics connectedCount={connectedCount} />

      {/* Integration cards */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 md:grid-cols-2">
        {SOURCE_INTEGRATION_SPECS.map((spec, index) => (
          <SourceIntegrationCard
            key={spec.provider}
            spec={spec}
            view={data[spec.provider]}
            config={data[`${spec.provider}Config`]}
            delay={index * CARD_STAGGER}
          />
        ))}
        <SlackIntegrationCard
          slack={data.slack}
          config={data.slackConfig}
          delay={SOURCE_INTEGRATION_SPECS.length * CARD_STAGGER}
        />
      </div>

      <SecurityPrinciples />

      {/* Bottom helper note */}
      <div className="bg-surface-container-low border-outline-variant/20 flex flex-col items-center justify-between gap-4 rounded-xl border px-6 py-4 shadow-sm sm:flex-row">
        <span className="text-on-surface-variant flex items-center gap-2 text-sm">
          <Webhook className="text-primary size-5 shrink-0" />
          <span>
            Looking for custom internal webhooks? Visit the{" "}
            <strong className="text-on-surface font-medium">
              Alert Studio
            </strong>{" "}
            in Notifications to build customized webhook schemas and telemetry
            consumers.
          </span>
        </span>
        <Button variant="surface" size="sm" className="text-secondary" asChild>
          <Link href="/settings/notifications">
            Go to Alert Studio
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
};
