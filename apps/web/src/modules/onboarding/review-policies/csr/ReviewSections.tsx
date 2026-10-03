import Link from "next/link";
import type { ReactNode } from "react";
import {
  ScrollText,
  TriangleAlert,
  Unlink,
  type LucideIcon,
} from "lucide-react";

import { formatMinutes, formatPolicyMatch } from "@/lib/format";
import type { PolicyImportReview } from "@/lib/types/onboarding";

/** An elevated review card with an icon-led heading. */
function ReviewSection({
  icon: Icon,
  iconClass,
  title,
  children,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-xl bg-surface-container p-6 shadow-elevated">
      <div className="flex items-center gap-2">
        <Icon className={`size-[18px] ${iconClass} shrink-0`} />
        <h2 className="font-headline-sm text-headline-sm text-on-surface">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

/** Every imported policy with its match rule and targets. */
export function ImportedPoliciesSection({
  review,
}: {
  review: PolicyImportReview;
}) {
  return (
    <ReviewSection
      icon={ScrollText}
      iconClass="text-primary"
      title="Imported policies"
    >
      {review.importedPolicies.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          No policies have been imported from {review.sourceLabel} yet.
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
    </ReviewSection>
  );
}

/** Open cases no policy applies to, linked to their case pages. */
export function UnmatchedCasesSection({
  review,
}: {
  review: PolicyImportReview;
}) {
  return (
    <ReviewSection
      icon={Unlink}
      iconClass="text-warning"
      title="Open cases with no matching policy"
    >
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
          +{review.unmatchedOverflowCount} more. Add a broader policy, or a
          catch-all, to cover them.
        </p>
      )}
    </ReviewSection>
  );
}

/** One line per kind of import problem that occurred. */
export function ImportWarningsSection({
  review,
}: {
  review: PolicyImportReview;
}) {
  return (
    <ReviewSection
      icon={TriangleAlert}
      iconClass="text-error"
      title="Import warnings"
    >
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
            referenced a schedule that wasn&apos;t imported — fell back to the
            always-open calendar.
          </li>
        )}
        {review.warnings.unsupportedMetrics > 0 && (
          <li>
            {review.warnings.unsupportedMetrics} SLA metric
            {review.warnings.unsupportedMetrics === 1 ? "" : "s"} from
            {review.sourceLabel} have no equivalent here.
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
            {review.warnings.policiesArchived === 1 ? "y was" : "ies were"}{" "}
            archived — no longer in {review.sourceLabel}.
          </li>
        )}
      </ul>
    </ReviewSection>
  );
}
