"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { EngineStateChip } from "@/components/shared/engine-state-chip";
import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import { ReauthBanner } from "@/components/shared/reauth-banner";
import { Button } from "@/components/ui/button";
import {
  deriveOnboardingProgress,
  providerStatus,
} from "@/lib/onboarding-progress";
import type { OnboardingStatus } from "@/lib/types/onboarding";

import { providerPresentation } from "@modules/settings/integrations/csr/provider-presentation";

import { ConnectSourceStep } from "./ConnectSourceStep";
import { ConnectorCard, ConnectorHeader } from "./ConnectorCards";
import { CorrelationPanel, NextStepPanel } from "./OnboardingPanels";
import { OnboardingProgress } from "./OnboardingProgress";
import {
  CreatePolicyCallout,
  ReviewPoliciesCallout,
  TrackerStepRibbon,
} from "./StepBanners";
import { OtherTrackersSection, PrimaryTrackerCard } from "./TrackerStepCards";
import { useOnboardingBackfill } from "./useOnboardingBackfill";
import {
  useOnboardingReturnFlags,
  useRedirectWhenComplete,
} from "./useOnboardingReturnFlags";

interface OnboardingFlowProps {
  initialStatus: OnboardingStatus;
}

/**
 * The guided flow (N5.1), built from what each connected provider can do and
 * not from which provider it is: step 1 connects a ticket source, step 2
 * watches its backfill and then either reviews imported policies (a source
 * with the `policyImport` capability) or offers a first native policy, step 3
 * optionally connects a work tracker. Any supported pair takes the same path.
 */
export function OnboardingFlow({ initialStatus }: OnboardingFlowProps) {
  const { status, error, isRunning, refresh } = useOnboardingBackfill({
    status: initialStatus,
  });

  const { reviewedPolicies } = useOnboardingReturnFlags(refresh);

  const {
    ticketSource,
    ticketSourceReady,
    importsPolicies,
    tracker,
    complete,
  } = deriveOnboardingProgress(status);
  const onboardingComplete = complete;

  const source = ticketSource ? providerStatus(status, ticketSource) : null;
  const trackerStatus = tracker ? providerStatus(status, tracker) : null;
  const sourceLabel = source?.label ?? "your helpdesk";
  const caseNoun = source
    ? providerPresentation(source.provider).caseNoun
    : "tickets";
  const trackerLabel = trackerStatus?.label ?? null;
  const sourceRunning = isRunning(ticketSource);
  const trackerRunning = isRunning(tracker);
  const trackerConnected = tracker !== null;

  const ticketSources = status.providers.filter(
    (p) => p.role === "ticket_source",
  );
  const trackers = status.providers.filter((p) => p.role === "work_tracker");
  const codeHosts = status.providers.filter((p) => p.role === "code_host");

  // A source that imports policies stops the flow to review them; one that
  // does not (D9) offers creating a first native policy, never blocking.
  const readyToReviewPolicies = ticketSourceReady && importsPolicies;
  const readyToCreatePolicy = ticketSourceReady && !importsPolicies;

  const readyToConnectTracker =
    ticketSourceReady &&
    (!importsPolicies || reviewedPolicies || trackerConnected);

  const currentStep: 1 | 2 | 3 | null =
    ticketSource === null
      ? 1
      : !readyToConnectTracker
        ? 2
        : !trackerConnected
          ? 3
          : null;

  useRedirectWhenComplete(onboardingComplete);

  if (source === null) {
    return (
      <ConnectSourceStep
        ticketSources={ticketSources}
        currentStep={currentStep}
        onConfigured={refresh}
      />
    );
  }

  if (source.reauthRequired) {
    return (
      <OnboardingShell
        title={`Reconnect ${source.label}`}
        currentStep={currentStep}
      >
        <Reveal>
          <ReauthBanner
            provider={source.label}
            reconnectHref={providerPresentation(source.provider).reconnectHref({
              subdomain: source.subdomain,
            })}
          />
        </Reveal>
      </OnboardingShell>
    );
  }

  // Stage 03 in the mockups: backfill is done and it's time to connect the
  // issue tracker. Drives both the top ribbon and which card takes the
  // primary (7-col) vs. secondary (5-col) slot below.
  const showTrackerCard = readyToConnectTracker && !trackerConnected;

  const engineStateValue = onboardingComplete
    ? "FINDINGS_READY"
    : showTrackerCard
      ? "AWAITING_TRACKER_AUTH"
      : sourceRunning || trackerRunning
        ? "REPLAYING_RECORDS"
        : "SYNCED";

  const [primaryTracker, ...otherTrackers] = trackers;
  const sourcePresentation = providerPresentation(source.provider);

  return (
    <OnboardingShell
      title={
        showTrackerCard
          ? "Connect engineering to close the SLA blindspot"
          : `Ingesting 90 days of historical ${caseNoun}`
      }
      description={
        showTrackerCard
          ? "When support escalates a ticket, does the SLA clock pause? Connect your issue tracker to reconstruct the continuous clock, or continue without one and add it later."
          : `Deterministic event replay in progress — parsing raw audit logs and inter-tier handoffs without mutating your ${sourceLabel} source records.`
      }
      currentStep={currentStep}
      wide
      headerAside={
        <EngineStateChip label="Engine state" value={engineStateValue} />
      }
    >
      {showTrackerCard && (
        <Reveal>
          <TrackerStepRibbon
            sourceLabel={sourceLabel}
            ticketsFetched={status.ticketsFetched}
            caseNoun={caseNoun}
          />
        </Reveal>
      )}

      {readyToReviewPolicies && (
        <Reveal>
          <ReviewPoliciesCallout reviewed={reviewedPolicies} />
        </Reveal>
      )}

      {readyToCreatePolicy && (
        <Reveal>
          <CreatePolicyCallout sourceLabel={sourceLabel} />
        </Reveal>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          {showTrackerCard && primaryTracker ? (
            <Reveal>
              <PrimaryTrackerCard
                tracker={primaryTracker}
                otherTrackers={otherTrackers}
                onConfigured={refresh}
              />
            </Reveal>
          ) : (
            <Reveal>
              <ConnectorCard>
                <ConnectorHeader
                  icon={sourcePresentation.icon}
                  name={source.label}
                  badge="Connected"
                  tagline={`Ingesting ${sourcePresentation.caseNoun} and their timelines`}
                  beta={sourcePresentation.beta}
                />

                <OnboardingProgress
                  status={status}
                  sourceLabel={sourceLabel}
                  caseNoun={caseNoun}
                  sourceRunning={sourceRunning}
                  trackerLabel={trackerLabel}
                  trackerRunning={trackerRunning}
                  error={error}
                />

                {onboardingComplete && (
                  <Button asChild>
                    <Link href="/onboarding/activation">
                      Setup complete
                      <ArrowRight className="size-[18px] shrink-0" />
                    </Link>
                  </Button>
                )}
              </ConnectorCard>
            </Reveal>
          )}
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Reveal>
            {showTrackerCard ? (
              <CorrelationPanel />
            ) : (
              !onboardingComplete && <NextStepPanel />
            )}
          </Reveal>
        </div>
      </div>

      {showTrackerCard &&
        (otherTrackers.length > 0 || codeHosts.length > 0) && (
          <Reveal>
            <OtherTrackersSection
              otherTrackers={otherTrackers}
              codeHosts={codeHosts}
              primaryTrackerLabel={primaryTracker?.label}
              onConfigured={refresh}
            />
          </Reveal>
        )}
    </OnboardingShell>
  );
}
