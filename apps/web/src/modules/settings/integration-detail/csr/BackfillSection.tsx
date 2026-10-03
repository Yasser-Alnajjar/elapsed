"use client";

import { CheckCircle2, History, Info } from "lucide-react";
import { Utils } from "@/lib/utils";
import type { IntegrationDetailData } from "@/lib/types/integrations";
import { GithubBackfillButton } from "../../integrations/csr/GithubCard";
import { IntercomBackfillButton } from "../../integrations/csr/IntercomCard";
import { JiraBackfillButton } from "../../integrations/csr/JiraCard";
import { LinearBackfillButton } from "../../integrations/csr/LinearCard";
import { ZendeskBackfillButton } from "../../integrations/csr/ZendeskCard";
import {
  labelClass,
  panelClass,
  SectionBadge,
  SectionCard,
} from "./detail-primitives";

type BackfillProps = Pick<
  IntegrationDetailData,
  "provider" | "reauthRequired" | "subdomain" | "repo"
>;

/** The provider's own 90-day backfill control. */
function ProviderBackfillButton({
  provider,
  reauthRequired,
  subdomain,
  repo,
}: BackfillProps) {
  switch (provider) {
    case "zendesk":
      return (
        <ZendeskBackfillButton
          subdomain={subdomain ?? ""}
          initialReauthRequired={reauthRequired}
        />
      );
    case "jira":
      return <JiraBackfillButton initialReauthRequired={reauthRequired} />;
    case "linear":
      return <LinearBackfillButton initialReauthRequired={reauthRequired} />;
    case "intercom":
      return <IntercomBackfillButton initialReauthRequired={reauthRequired} />;
    case "github":
      return (
        <GithubBackfillButton
          repo={repo ?? ""}
          initialReauthRequired={reauthRequired}
        />
      );
  }
}

export function BackfillSection({
  backfillCompletedAt,
  ...backfill
}: BackfillProps & { backfillCompletedAt: Date | null }) {
  return (
    <SectionCard
      icon={<History className="size-4" />}
      title="Historical backfill & calibration"
      description="Import the last 90 days of data"
      badge={
        <SectionBadge
          tone={backfillCompletedAt ? "success" : "primary"}
          icon={
            backfillCompletedAt ? (
              <CheckCircle2 className="size-3.5" />
            ) : undefined
          }
        >
          {backfillCompletedAt ? "Completed" : "Pending"}
        </SectionBadge>
      }
    >
      {backfillCompletedAt && (
        <div className={panelClass}>
          <span className={labelClass}>Baseline ingestion cycle</span>
          <span className="text-on-surface font-mono text-sm font-semibold">
            Finished {Utils.formatDateTimeV2(backfillCompletedAt)}
          </span>
        </div>
      )}

      <div className="bg-surface-container flex flex-col gap-4 rounded-lg p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-3xl items-start gap-3">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-xs text-on-surface-variant">
            <strong className="text-on-surface font-medium">
              Backfill data is immutable.
            </strong>{" "}
            Re-running evaluates any unlinked records without modifying the
            established baseline.
          </p>
        </div>

        <div className="min-w-0 shrink-0">
          <ProviderBackfillButton {...backfill} />
        </div>
      </div>
    </SectionCard>
  );
}
