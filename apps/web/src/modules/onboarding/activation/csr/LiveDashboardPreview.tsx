import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import type { ActivationPageData } from "@/lib/types/onboarding";
import { AtRiskSnapshotTable } from "@modules/dashboard/dashboard/csr/AtRiskSnapshotTable";
import { DESCRIPTION_CLASS } from "./constants";

/** A first look at the live at-risk table, capped to a preview with a link to the rest. */
export function LiveDashboardPreview({
  rows,
  total,
  engineeringMeasured,
}: {
  rows: ActivationPageData["atRiskPreview"];
  total: number;
  engineeringMeasured: boolean;
}) {
  const overflowCount = Math.max(0, total - rows.length);

  return (
    <div className="overflow-hidden rounded-xl bg-surface-container shadow-elevated">
      <div className="flex flex-col gap-3 bg-surface-container-low p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-error" />
            <h3 className="font-headline-sm text-headline-sm text-on-surface">
              Live operations dashboard preview
            </h3>
          </div>
          <p className={DESCRIPTION_CLASS}>
            Open commitments currently consuming SLA runway right now.
          </p>
        </div>
        {total > 0 && (
          <span className="font-code-audit text-code-audit rounded bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
            {total} open commitment{total === 1 ? "" : "s"} at risk or breached
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={CheckCircle2}
            title="Nothing at risk right now"
            description="No open commitment is currently at risk or breached."
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <AtRiskSnapshotTable
              rows={rows}
              engineeringMeasured={engineeringMeasured}
            />
          </div>
          {overflowCount > 0 && (
            <div className="border-t border-outline-variant/20 px-5 py-3">
              <Link
                href="/at-risk"
                className="font-body-sm text-body-sm text-primary hover:underline"
              >
                +{overflowCount} more open commitment
                {overflowCount === 1 ? "" : "s"} — view all
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
