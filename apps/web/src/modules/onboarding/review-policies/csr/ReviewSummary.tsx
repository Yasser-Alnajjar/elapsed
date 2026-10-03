import { formatExactTimestamp } from "@/lib/format";
import type { PolicyImportReview } from "@/lib/types/onboarding";
import {
  TONE_DOT,
  TONE_SURFACE,
  TONE_TEXT,
  type Tone,
} from "@/lib/status-styles";

/** Import status line: whether the import ran, how many policies, and when. */
export function ImportStatusBar({ review }: { review: PolicyImportReview }) {
  return (
    <div className="font-code-audit text-code-audit flex flex-wrap items-center gap-x-3 gap-y-2 rounded bg-surface-container-low px-3 py-2 text-on-surface-variant">
      <span className="inline-flex items-center gap-1.5 rounded bg-surface-container-lowest px-2 py-0.5 text-primary">
        <span className="size-1.5 rounded-full bg-primary animate-pulse" />
        {review.lastImportAt ? "POLICY_IMPORT_COMPLETE" : "AWAITING_IMPORT"}
      </span>
      <span className="text-muted-foreground">/</span>
      <span>
        IMPORTED: {review.importedPolicies.length.toLocaleString()}{" "}
        {review.importedPolicies.length === 1 ? "policy" : "policies"}
      </span>
      {review.lastImportAt && (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="text-tertiary">
            LAST RUN: {formatExactTimestamp(review.lastImportAt)}
          </span>
        </>
      )}
    </div>
  );
}

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
  const classes = {
    bar: TONE_DOT[tone],
    value: TONE_TEXT[tone],
    badge: TONE_SURFACE[tone],
  };

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

/** Imported / Matched / No match / Warnings tiles. */
export function ReviewStatTiles({
  review,
  totalWarnings,
}: {
  review: PolicyImportReview;
  totalWarnings: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile
        label="Imported policies"
        value={review.importedPolicies.length}
        badge={review.sourceLabel}
        tone="success"
        description={`Active SLA policies pulled from ${review.sourceLabel}.`}
      />
      <StatTile
        label="Matched cases"
        value={review.matchedCaseCount}
        badge="Covered"
        tone="success"
        description="Open cases with at least one matching commitment."
      />
      <StatTile
        label="No match"
        value={review.unmatchedCaseCount}
        badge={review.unmatchedCaseCount > 0 ? "Blind spot" : "Clear"}
        tone={review.unmatchedCaseCount > 0 ? "warning" : "success"}
        description="Open cases with no policy applied to them."
      />
      <StatTile
        label="Warnings"
        value={totalWarnings}
        badge={totalWarnings > 0 ? "Review" : "Clean"}
        tone={totalWarnings > 0 ? "danger" : "success"}
        description="Import issues that need a look before you rely on this."
      />
    </div>
  );
}
