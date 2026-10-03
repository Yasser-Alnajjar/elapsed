"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IntegrationsPageData } from "@/lib/types/integrations";
import { IntegrationsHeader } from "./IntegrationsHeader";
import { IntegrationsMetrics } from "./IntegrationsMetrics";
import { SecurityPrinciples } from "./SecurityPrinciples";
import { SlackIntegrationCard } from "./SlackIntegrationCard";
import { SourceIntegrationCard } from "./SourceIntegrationCard";
import { SOURCE_INTEGRATION_SPECS } from "./source-integration-specs";
import { groupSpecsByRole, SOURCE_ROLE_GROUPS } from "./integration-groups";

interface IntegrationsViewProps {
  data: IntegrationsPageData;
}

const CARD_STAGGER = 0.05;

const cardGridClass = "grid grid-cols-1 gap-6 xl:grid-cols-3 md:grid-cols-2";

/** One titled group of provider cards. */
function IntegrationGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col">
        <h2 className="text-on-surface font-display text-lg font-semibold">
          {title}
        </h2>
        <span className="text-outline font-mono text-xxs uppercase">
          {description}
        </span>
      </div>
      <div className={cardGridClass}>{children}</div>
    </section>
  );
}

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

      {/* Integration cards, grouped by each provider adapter's role */}
      {groupSpecsByRole(SOURCE_INTEGRATION_SPECS, data).map(
        ({ role, specs }) => (
          <IntegrationGroup key={role} {...SOURCE_ROLE_GROUPS[role]}>
            {specs.map((spec) => (
              <SourceIntegrationCard
                key={spec.provider}
                spec={spec}
                view={data[spec.provider]}
                config={data[`${spec.provider}Config`]}
                delay={SOURCE_INTEGRATION_SPECS.indexOf(spec) * CARD_STAGGER}
              />
            ))}
          </IntegrationGroup>
        ),
      )}

      {/* Slack, the only notification channel. */}
      <IntegrationGroup
        title="Notification channels"
        description="Where at-risk and breach alerts are sent"
      >
        <SlackIntegrationCard
          slack={data.slack}
          config={data.slackConfig}
          delay={SOURCE_INTEGRATION_SPECS.length * CARD_STAGGER}
        />
      </IntegrationGroup>

      <SecurityPrinciples />

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
