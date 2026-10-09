"use client";

import { CreditCard } from "lucide-react";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { RESOURCE_LABELS, type LimitedResource } from "@sla/db/plans";
import { AlertDescription } from "@/components/ui/alert";
import { DismissibleAlert } from "@/components/ui/dismissible-alert";
import { formatExactTimestamp } from "@/lib/format";
import { UpgradeCtaLink } from "@/components/shared/entitlement-alerts";

export interface PlanNotice {
  trialExpiredAt: string | null;
  /** Whether adding configuration is actually paused. Defaults to true; false while plan enforcement is off. */
  trialRestricted?: boolean;
  overLimit: { resource: LimitedResource; used: number; limit: number }[];
}

/**
 * The in-app notice for plan state (N6.3, N6.4). It never says monitoring is
 * affected, because it is not: only adding new configuration is.
 */
export function PlanNoticeBanner({ notice }: { notice: PlanNotice }) {
  const timeZone = useOrgTimezone();
  if (notice.trialExpiredAt) {
    return (
      <DismissibleAlert variant="warning" className="mb-4">
        <CreditCard />
        <AlertDescription>
          Your trial ended on {formatExactTimestamp(notice.trialExpiredAt, timeZone)}. Cases, SLA monitoring, alerts and history keep working;{" "}
          {notice.trialRestricted === false
            ? "choose a plan to keep adding members, integrations and SLA policies."
            : "adding members, integrations or SLA policies is paused until you upgrade."}{" "}
          <UpgradeCtaLink />
        </AlertDescription>
      </DismissibleAlert>
    );
  }
  if (notice.overLimit.length === 0) return null;
  return (
    <DismissibleAlert variant="warning" className="mb-4">
      <CreditCard />
      <AlertDescription>
        Your organization is over its plan:{" "}
        {notice.overLimit.map((row) => `${row.used} of ${row.limit} ${RESOURCE_LABELS[row.resource]}`).join(", ")}. Nothing is switched off. <UpgradeCtaLink />
      </AlertDescription>
    </DismissibleAlert>
  );
}
