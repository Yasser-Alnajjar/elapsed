"use client";

import Link from "next/link";
import { ArrowRight, CircleCheckBig } from "lucide-react";

import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import type { PolicyImportReview } from "@/lib/types/onboarding";

import {
  ImportedPoliciesSection,
  ImportWarningsSection,
  UnmatchedCasesSection,
} from "./ReviewSections";
import { ImportStatusBar, ReviewStatTiles } from "./ReviewSummary";

interface ReviewPoliciesViewProps {
  review: PolicyImportReview;
}

/**
 * Phase 6.7: Imported / Matched / No match / Warnings, read from
 * `SlaImportSummary` (Phase 1.12) plus a live "no matching policy" case
 * list (the same query the dashboard's Blind Spots panel uses, Phase 6.2).
 * A required stop in the guided onboarding flow (Phase 6.6) between the
 * backfill and calendar/alert configuration — silent policy gaps are
 * exactly what this phase's dashboard work exists to surface, so onboarding
 * shouldn't let them stay invisible either. Styled to match the rest of the
 * onboarding flow's Stitch design language instead of the generic shadcn
 * card/list treatment it used before.
 */
export function ReviewPoliciesView({ review }: ReviewPoliciesViewProps) {
  const totalWarnings =
    review.warnings.unsupportedConditions +
    review.warnings.unsupportedMetrics +
    review.warnings.policiesWithNoUsableTargets +
    review.warnings.policiesWithUnresolvedSchedule +
    review.warnings.policiesArchived;

  const allClear =
    totalWarnings === 0 &&
    review.unmatchedCaseCount === 0 &&
    review.importedPolicies.length > 0;

  return (
    <OnboardingShell
      title="Review your imported SLA policies"
      description={`Elapsed imported your ${review.sourceLabel} SLA policies with zero configuration — confirm what matched before connecting your work tracker.`}
      currentStep={2}
      wide
    >
      <Reveal>
        <ImportStatusBar review={review} />
      </Reveal>

      <Reveal>
        <ReviewStatTiles review={review} totalWarnings={totalWarnings} />
      </Reveal>

      <Reveal>
        <ImportedPoliciesSection review={review} />
      </Reveal>

      {review.unmatchedCases.length > 0 && (
        <Reveal>
          <UnmatchedCasesSection review={review} />
        </Reveal>
      )}

      {totalWarnings > 0 && (
        <Reveal>
          <ImportWarningsSection review={review} />
        </Reveal>
      )}

      {allClear && (
        <Reveal>
          <div className="flex items-center gap-2.5 rounded-lg bg-tertiary/10 px-4 py-3 text-tertiary">
            <CircleCheckBig className="size-[18px] shrink-0" />
            <p className="font-body-sm text-body-sm">
              Every open case matches a policy, with no import warnings.
            </p>
          </div>
        </Reveal>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="outline" asChild>
          <Link href="/settings/sla/configuration">Configure calendars</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/settings/notifications">Configure alerts</Link>
        </Button>
        <Button asChild>
          <Link href="/onboarding?reviewed=1">
            Continue
            <ArrowRight className="size-[18px] shrink-0" />
          </Link>
        </Button>
      </div>
    </OnboardingShell>
  );
}
