"use client";

import Link from "next/link";
import {
  ArrowRight,
  CircleCheckBig,
  ScrollText,
  TriangleAlert,
  Unlink,
} from "lucide-react";

import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import {
  formatExactTimestamp,
  formatMinutes,
  formatPolicyMatch,
} from "@/lib/format";
import type { PolicyImportReview } from "@/lib/types/onboarding";

interface ReviewPoliciesViewProps {
  review: PolicyImportReview;
}

type Tone = "good" | "warn" | "error";

const TONE_CLASSES: Record<
  Tone,
  { bar: string; value: string; badge: string }
> = {
  good: {
    bar: "bg-tertiary",
    value: "text-tertiary",
    badge: "bg-tertiary/10 text-tertiary",
  },
  warn: {
    bar: "bg-warning",
    value: "text-warning",
    badge: "bg-warning/10 text-warning",
  },
  error: {
    bar: "bg-error",
    value: "text-error",
    badge: "bg-error/10 text-error",
  },
};

/** One stat tile of the review matrix — colored left-accent bar per severity, matching the Stitch mockups' "diagnostic" card idiom used across the rest of onboarding. */
function StatTile({
  label,
  value,
  badge,
  tone,
  description,
}: {
  label: string;
  value: number;
  badge: string;
  tone: Tone;
  description: string;
}) {
  const classes = TONE_CLASSES[tone];

  return (
    <div className="relative overflow-hidden rounded-lg bg-surface-container p-4 shadow-sm">
      <div className={`absolute inset-y-0 inset-s-0 w-1 ${classes.bar}`} />
      <div className="space-y-1.5 ps-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
            {label}
          </span>
          <span
            className={`font-label-caps text-label-caps rounded px-1.5 py-0.5 uppercase ${classes.badge}`}
          >
            {badge}
          </span>
        </div>
        <div
          className={`font-mono-metric-lg text-mono-metric-lg ${classes.value}`}
        >
          {value.toLocaleString()}
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {description}
        </p>
      </div>
    </div>
  );
}

/**
 * Phase 6.7: Imported / Matched / No match / Warnings, read from
 * `SlaImportSummary` (Phase 1.12) plus a live "no matching policy" case
 * list (the same query the dashboard's Blind Spots panel uses, Phase 6.2).
 * A required stop in the guided onboarding flow (Phase 6.6) between the
 * Zendesk backfill and calendar/alert configuration — silent policy gaps are
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
      description="Elapsed imported your Zendesk SLA policies with zero configuration — confirm what matched before connecting Jira."
      currentStep={2}
      wide
    >
      <Reveal>
        <div className="font-code-audit text-code-audit flex flex-wrap items-center gap-x-3 gap-y-2 rounded bg-surface-container-low px-3 py-2 text-on-surface-variant">
          <span className="inline-flex items-center gap-1.5 rounded bg-surface-container-lowest px-2 py-0.5 text-primary">
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
            {review.lastImportAt ? "POLICY_IMPORT_COMPLETE" : "AWAITING_IMPORT"}
          </span>
          <span className="text-outline-variant">/</span>
          <span>
            IMPORTED: {review.importedPolicies.length.toLocaleString()}{" "}
            {review.importedPolicies.length === 1 ? "policy" : "policies"}
          </span>
          {review.lastImportAt && (
            <>
              <span className="text-outline-variant">/</span>
              <span className="text-tertiary">
                LAST RUN: {formatExactTimestamp(review.lastImportAt)}
              </span>
            </>
          )}
        </div>
      </Reveal>

      <Reveal>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Imported policies"
            value={review.importedPolicies.length}
            badge="Zendesk"
            tone="good"
            description="Active SLA policies pulled from Zendesk."
          />
          <StatTile
            label="Matched cases"
            value={review.matchedCaseCount}
            badge="Covered"
            tone="good"
            description="Open cases with at least one matching commitment."
          />
          <StatTile
            label="No match"
            value={review.unmatchedCaseCount}
            badge={review.unmatchedCaseCount > 0 ? "Blind spot" : "Clear"}
            tone={review.unmatchedCaseCount > 0 ? "warn" : "good"}
            description="Open cases with no policy applied to them."
          />
          <StatTile
            label="Warnings"
            value={totalWarnings}
            badge={totalWarnings > 0 ? "Review" : "Clean"}
            tone={totalWarnings > 0 ? "error" : "good"}
            description="Import issues that need a look before you rely on this."
          />
        </div>
      </Reveal>

      <Reveal>
        <div className="space-y-4 rounded-xl bg-surface-container p-6 shadow-elevated">
          <div className="flex items-center gap-2">
            <ScrollText className="size-[18px] text-primary shrink-0" />
            <h2 className="font-headline-sm text-headline-sm text-on-surface">
              Imported policies
            </h2>
          </div>

          {review.importedPolicies.length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              No policies have been imported from Zendesk yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {review.importedPolicies.map((policy) => (
                <li
                  key={policy.id}
                  className="flex flex-col gap-1 rounded-lg bg-surface-container-low px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-headline-sm text-[14px] font-medium text-on-surface">
                      {policy.name}
                    </span>
                    {policy.overridden && (
                      <span className="font-label-caps text-label-caps rounded bg-surface-container-high px-1.5 py-0.5 uppercase text-on-surface-variant">
                        Overridden
                      </span>
                    )}
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {formatPolicyMatch(policy.match)}
                  </p>
                  <p className="font-code-audit text-code-audit text-on-surface-variant/80">
                    {policy.targets
                      .map(
                        (t) =>
                          `${t.kind.replace("_", " ")}: ${formatMinutes(t.minutes)}`,
                      )
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Reveal>

      {review.unmatchedCases.length > 0 && (
        <Reveal>
          <div className="space-y-4 rounded-xl bg-surface-container p-6 shadow-elevated">
            <div className="flex items-center gap-2">
              <Unlink className="size-[18px] text-warning shrink-0" />
              <h2 className="font-headline-sm text-headline-sm text-on-surface">
                Open cases with no matching policy
              </h2>
            </div>

            <ul className="space-y-1.5">
              {review.unmatchedCases.map((row) => (
                <li
                  key={row.caseId}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-low px-4 py-2.5"
                >
                  <Link
                    href={`/cases/${row.caseId}`}
                    className="font-body-sm text-body-sm truncate text-primary hover:underline"
                  >
                    #{row.externalId} {row.subject ?? ""}
                  </Link>
                  <span className="font-code-audit text-code-audit shrink-0 text-on-surface-variant">
                    {row.customerName ?? "No customer"}
                  </span>
                </li>
              ))}
            </ul>

            {review.unmatchedOverflowCount > 0 && (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                +{review.unmatchedOverflowCount} more. Add a broader policy, or
                a catch-all, to cover them.
              </p>
            )}
          </div>
        </Reveal>
      )}

      {totalWarnings > 0 && (
        <Reveal>
          <div className="space-y-4 rounded-xl bg-surface-container p-6 shadow-elevated">
            <div className="flex items-center gap-2">
              <TriangleAlert className="size-[18px] text-error shrink-0" />
              <h2 className="font-headline-sm text-headline-sm text-on-surface">
                Import warnings
              </h2>
            </div>

            <ul className="font-body-sm text-body-sm space-y-1.5 text-on-surface-variant">
              {review.warnings.policiesWithNoUsableTargets > 0 && (
                <li>
                  {review.warnings.policiesWithNoUsableTargets} polic
                  {review.warnings.policiesWithNoUsableTargets === 1
                    ? "y produced"
                    : "ies produced"}{" "}
                  no usable SLA target.
                </li>
              )}
              {review.warnings.policiesWithUnresolvedSchedule > 0 && (
                <li>
                  {review.warnings.policiesWithUnresolvedSchedule} polic
                  {review.warnings.policiesWithUnresolvedSchedule === 1
                    ? "y"
                    : "ies"}{" "}
                  referenced a schedule that wasn&apos;t imported — fell back to
                  the always-open calendar.
                </li>
              )}
              {review.warnings.unsupportedMetrics > 0 && (
                <li>
                  {review.warnings.unsupportedMetrics} SLA metric
                  {review.warnings.unsupportedMetrics === 1 ? "" : "s"} from
                  Zendesk have no equivalent here.
                </li>
              )}
              {review.warnings.unsupportedConditions > 0 && (
                <li>
                  {review.warnings.unsupportedConditions} match condition
                  {review.warnings.unsupportedConditions === 1 ? "" : "s"}{" "}
                  couldn&apos;t be represented.
                </li>
              )}
              {review.warnings.policiesArchived > 0 && (
                <li>
                  {review.warnings.policiesArchived} polic
                  {review.warnings.policiesArchived === 1
                    ? "y was"
                    : "ies were"}{" "}
                  archived — no longer in Zendesk.
                </li>
              )}
            </ul>
          </div>
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
