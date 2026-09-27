"use client";

import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatExactTimestamp, formatMinutes, formatPolicyMatch } from "@/lib/format";
import type { PolicyImportReview } from "@/lib/types/onboarding";

interface ReviewPoliciesViewProps {
  review: PolicyImportReview;
}

function StatBlock({ label, value, tone }: { label: string; value: number; tone?: "warning" | "error" }) {
  return (
    <div className="rounded-lg border border-border bg-interactive/30 px-3 py-2.5">
      <p
        className={`font-display text-xl font-medium tracking-tight ${
          tone === "error" ? "text-destructive" : tone === "warning" ? "text-warning" : ""
        }`}
      >
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
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
 * shouldn't let them stay invisible either.
 */
export function ReviewPoliciesView({ review }: ReviewPoliciesViewProps) {
  const totalWarnings =
    review.warnings.unsupportedConditions +
    review.warnings.unsupportedMetrics +
    review.warnings.policiesWithNoUsableTargets +
    review.warnings.policiesWithUnresolvedSchedule +
    review.warnings.policiesArchived;

  return (
    <OnboardingShell
      title="Review your imported SLA policies"
      description={
        review.lastImportAt
          ? `Last imported ${formatExactTimestamp(review.lastImportAt)}.`
          : "No import has run yet — connect Zendesk to import your policies."
      }
      currentStep={2}
    >
      <Reveal>
        <Card>
          <CardContent className="space-y-5 pt-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBlock label="Imported policies" value={review.importedPolicies.length} />
              <StatBlock label="Matched cases" value={review.matchedCaseCount} />
              <StatBlock
                label="No match"
                value={review.unmatchedCaseCount}
                tone={review.unmatchedCaseCount > 0 ? "warning" : undefined}
              />
              <StatBlock
                label="Warnings"
                value={totalWarnings}
                tone={totalWarnings > 0 ? "error" : undefined}
              />
            </div>

            <div>
              <h2 className="mb-3 text-sm font-medium text-foreground">Imported policies</h2>
              {review.importedPolicies.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No policies have been imported from Zendesk yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {review.importedPolicies.map((policy) => (
                    <li
                      key={policy.id}
                      className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{policy.name}</span>
                        {policy.overridden && (
                          <span className="rounded bg-interactive px-1.5 py-0.5 text-xxs text-muted-foreground">
                            Overridden
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatPolicyMatch(policy.match)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {policy.targets
                          .map((t) => `${t.kind.replace("_", " ")}: ${formatMinutes(t.minutes)}`)
                          .join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {review.unmatchedCases.length > 0 && (
              <div>
                <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <AlertTriangle className="size-4 text-warning" />
                  Open cases with no matching policy
                </h2>
                <ul className="space-y-1.5">
                  {review.unmatchedCases.map((row) => (
                    <li key={row.caseId} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={`/cases/${row.caseId}`} className="truncate text-primary hover:underline">
                        #{row.externalId} {row.subject ?? ""}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {row.customerName ?? "No customer"}
                      </span>
                    </li>
                  ))}
                </ul>
                {review.unmatchedOverflowCount > 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    +{review.unmatchedOverflowCount} more. Add a broader policy, or a catch-all, to cover them.
                  </p>
                )}
              </div>
            )}

            {totalWarnings > 0 && (
              <div>
                <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <AlertTriangle className="size-4 text-destructive" />
                  Import warnings
                </h2>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {review.warnings.policiesWithNoUsableTargets > 0 && (
                    <li>
                      {review.warnings.policiesWithNoUsableTargets} polic
                      {review.warnings.policiesWithNoUsableTargets === 1 ? "y produced" : "ies produced"} no usable
                      SLA target.
                    </li>
                  )}
                  {review.warnings.policiesWithUnresolvedSchedule > 0 && (
                    <li>
                      {review.warnings.policiesWithUnresolvedSchedule} polic
                      {review.warnings.policiesWithUnresolvedSchedule === 1 ? "y" : "ies"} referenced a schedule
                      that wasn't imported — fell back to the always-open calendar.
                    </li>
                  )}
                  {review.warnings.unsupportedMetrics > 0 && (
                    <li>
                      {review.warnings.unsupportedMetrics} SLA metric
                      {review.warnings.unsupportedMetrics === 1 ? "" : "s"} from Zendesk have no equivalent here.
                    </li>
                  )}
                  {review.warnings.unsupportedConditions > 0 && (
                    <li>
                      {review.warnings.unsupportedConditions} match condition
                      {review.warnings.unsupportedConditions === 1 ? "" : "s"} couldn't be represented.
                    </li>
                  )}
                  {review.warnings.policiesArchived > 0 && (
                    <li>
                      {review.warnings.policiesArchived} polic
                      {review.warnings.policiesArchived === 1 ? "y was" : "ies were"} archived — no longer in
                      Zendesk.
                    </li>
                  )}
                </ul>
              </div>
            )}

            {totalWarnings === 0 && review.unmatchedCaseCount === 0 && review.importedPolicies.length > 0 && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-success" />
                Every open case matches a policy, with no import warnings.
              </p>
            )}
          </CardContent>
        </Card>
      </Reveal>

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
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </OnboardingShell>
  );
}
