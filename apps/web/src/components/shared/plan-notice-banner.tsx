import { CreditCard } from "lucide-react";
import { RESOURCE_LABELS, type LimitedResource } from "@sla/db/plans";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatExactTimestamp } from "@/lib/format";
import { UpgradeCtaLink } from "@/components/shared/entitlement-alerts";

export interface PlanNotice {
  trialExpiredAt: string | null;
  overLimit: { resource: LimitedResource; used: number; limit: number }[];
}

/**
 * The in-app notice for plan state (N6.3, N6.4). It never says monitoring is
 * affected, because it is not: only adding new configuration is.
 */
export function PlanNoticeBanner({ notice }: { notice: PlanNotice }) {
  if (notice.trialExpiredAt) {
    return (
      <Alert variant="warning" className="mb-4">
        <CreditCard />
        <AlertDescription>
          Your trial ended on {formatExactTimestamp(notice.trialExpiredAt)}. Cases, SLA monitoring, alerts and history keep working; adding members,
          integrations or SLA policies is paused until you upgrade. <UpgradeCtaLink />
        </AlertDescription>
      </Alert>
    );
  }
  if (notice.overLimit.length === 0) return null;
  return (
    <Alert variant="warning" className="mb-4">
      <CreditCard />
      <AlertDescription>
        Your organization is over its plan:{" "}
        {notice.overLimit.map((row) => `${row.used} of ${row.limit} ${RESOURCE_LABELS[row.resource]}`).join(", ")}. Nothing is switched off. <UpgradeCtaLink />
      </AlertDescription>
    </Alert>
  );
}
