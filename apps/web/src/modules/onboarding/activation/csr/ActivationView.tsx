"use client";

import { ListChecks, TrendingUp } from "lucide-react";

import { EngineStateChip } from "@/components/shared/engine-state-chip";
import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import {
  deriveOnboardingProgress,
  providerStatus,
} from "@/lib/onboarding-progress";
import type { ActivationPageData } from "@/lib/types/onboarding";

import { providerPresentation } from "@modules/settings/integrations/csr/provider-presentation";

import { ActivationHero } from "./ActivationHero";
import { ActivationSection } from "./ActivationSection";
import { FindingsSection } from "./FindingsSection";
import { GuaranteesPanel } from "./GuaranteesPanel";
import { HealthMatrix } from "./HealthMatrix";
import { InviteTeammateBox } from "./InviteTeammateBox";
import { LiveDashboardPreview } from "./LiveDashboardPreview";
import { SetupProgressBar } from "./SetupProgressBar";

export function ActivationView({ data }: { data: ActivationPageData }) {
  const {
    status,
    atRiskPreview,
    atRiskTotal,
    slackConnected,
    emailConfigured,
    importedPolicyCount,
    findings,
  } = data;

  // Names the ticket source and tracker that are actually connected. The
  // tracker is optional (N5.2): without one, engineering time is "not yet".
  const { ticketSource, tracker } = deriveOnboardingProgress(status);
  const source = ticketSource ? providerStatus(status, ticketSource) : null;
  const trackerStatus = tracker ? providerStatus(status, tracker) : null;
  const sourceLabel = source?.label ?? "Your helpdesk";
  const trackerLabel = trackerStatus?.label ?? null;
  const ticketNoun = source
    ? providerPresentation(source.provider).caseNoun
    : "tickets";

  return (
    <OnboardingShell
      title="Activation"
      currentStep={4}
      wide
      headerAside={
        <EngineStateChip label="Engine state" value="TRACKING_LIVE" />
      }
    >
      <Reveal>
        <SetupProgressBar
          steps={[
            {
              number: "01",
              label: `${sourceLabel} workspace`,
              detail: `${status.ticketsFetched.toLocaleString()} ${ticketNoun} ingested`,
            },
            {
              number: "02",
              label: "90d Baseline Data",
              detail: `${status.ticketsFetched.toLocaleString()} ${ticketNoun} verified`,
            },
            trackerLabel !== null
              ? {
                  number: "03",
                  label: trackerLabel,
                  detail: `${status.linkedIssues.toLocaleString()} issue keys paired`,
                }
              : {
                  number: "03",
                  label: "Work tracker",
                  detail: "Optional — not connected yet",
                  pending: true,
                },
            {
              number: "04",
              label: "Live SLA",
              detail: "Continuous tracking active",
            },
          ]}
        />
      </Reveal>

      <Reveal>
        <ActivationHero
          status={status}
          sourceLabel={sourceLabel}
          trackerLabel={trackerLabel}
          ticketNoun={ticketNoun}
        />
      </Reveal>

      <Reveal>
        <ActivationSection
          icon={TrendingUp}
          title="What the 90-day backfill found"
        >
          <FindingsSection findings={findings} trackerLabel={trackerLabel} />
        </ActivationSection>
      </Reveal>

      <Reveal>
        <ActivationSection
          icon={ListChecks}
          title={<>Pre-flight synchronization &amp; health matrix</>}
        >
          <HealthMatrix
            status={status}
            sourceLabel={sourceLabel}
            trackerLabel={trackerLabel}
            ticketNoun={ticketNoun}
            importedPolicyCount={importedPolicyCount}
            slackConnected={slackConnected}
            emailConfigured={emailConfigured}
          />
        </ActivationSection>
      </Reveal>

      <Reveal>
        <LiveDashboardPreview
          rows={atRiskPreview}
          total={atRiskTotal}
          engineeringMeasured={trackerLabel !== null}
        />
      </Reveal>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <GuaranteesPanel
            sourceLabel={sourceLabel}
            trackerLabel={trackerLabel}
          />
        </Reveal>

        <Reveal>
          <InviteTeammateBox />
        </Reveal>
      </div>
      <Reveal>
        <div className="flex flex-col items-center justify-between gap-3 rounded-lg bg-surface-container-lowest p-4 text-center sm:flex-row sm:text-start">
          <div className="font-code-audit text-code-audit flex flex-wrap items-center justify-center gap-3 text-on-surface-variant sm:justify-start">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-tertiary" />
              <span className="font-semibold text-on-surface">
                Elapsed — live SLA engine
              </span>
            </span>
            <span className="text-on-surface-variant/40">|</span>
            <span>Read-only by design</span>
          </div>
          <div className="font-code-audit text-code-audit text-on-surface-variant">
            Zero mutation · Deterministic correlation · Continuous clock
          </div>
        </div>
      </Reveal>
    </OnboardingShell>
  );
}
