"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ProviderOnboardingStatus } from "@/lib/types/onboarding";

import {
  AlternativeConnectorCard,
  PrimaryConnectorCard,
} from "./ConnectorCards";
import { RequestTrackerAccess } from "./RequestTrackerAccess";

const joinLabels = (providers: ProviderOnboardingStatus[]) =>
  providers.map((p) => p.label).join(" or ");

/** Step 3's primary tracker card, with the ask-an-admin and skip options under it. */
export function PrimaryTrackerCard({
  tracker,
  otherTrackers,
  onConfigured,
}: {
  tracker: ProviderOnboardingStatus;
  otherTrackers: ProviderOnboardingStatus[];
  onConfigured: () => void;
}) {
  return (
    <PrimaryConnectorCard
      provider={tracker}
      onConfigured={onConfigured}
      description={`Connect ${tracker.label} to add engineering-leg timing and correlate support cases with engineering work${
        otherTrackers.length > 0
          ? `, or choose ${joinLabels(otherTrackers)} below`
          : ""
      }.`}
      footer={
        <div className="flex flex-col gap-4">
          <RequestTrackerAccess
            provider={tracker.provider}
            label={tracker.label}
          />
          <Button variant="outline" asChild className="self-start">
            <Link href="/onboarding/activation">
              Continue without a tracker
              <ArrowRight className="size-[18px] shrink-0" />
            </Link>
          </Button>
        </div>
      }
    />
  );
}

/** The other trackers and code hosts offered under the primary tracker. */
export function OtherTrackersSection({
  otherTrackers,
  codeHosts,
  primaryTrackerLabel,
  onConfigured,
}: {
  otherTrackers: ProviderOnboardingStatus[];
  codeHosts: ProviderOnboardingStatus[];
  primaryTrackerLabel: string | undefined;
  onConfigured: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
          Or choose another issue tracker
        </span>
        <span className="font-code-audit text-code-audit text-on-surface-variant/70">
          {otherTrackers.length > 0
            ? `${joinLabels(otherTrackers)} completes this step like ${primaryTrackerLabel ?? "the primary tracker"} does; configure the rest later from Settings`
            : "Configure the rest later from Settings"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[...otherTrackers, ...codeHosts].map((provider) => (
          <AlternativeConnectorCard
            key={provider.provider}
            provider={provider}
            onConfigured={onConfigured}
          />
        ))}
      </div>
    </div>
  );
}
