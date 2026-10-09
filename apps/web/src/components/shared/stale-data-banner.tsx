"use client";

import { ShieldAlert } from "lucide-react";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { AlertDescription } from "@/components/ui/alert";
import { DismissibleAlert } from "@/components/ui/dismissible-alert";
import { formatExactTimestamp } from "@/lib/format";

/** `staleSince: null` means the integration has never completed a successful sync. */
export function StaleDataBanner({ integrations }: { integrations: { provider: string; staleSince: string | null }[] }) {
  const timeZone = useOrgTimezone();
  if (integrations.length === 0) return null;
  const names = integrations.map((row) => row.provider).join(", ");
  const since = integrations.flatMap((row) => (row.staleSince ? [row.staleSince] : [])).sort()[0];
  return (
    <DismissibleAlert variant="warning" className="mb-4">
      <ShieldAlert />
      <AlertDescription>
        {since
          ? `Data from ${names} is stale since ${formatExactTimestamp(since, timeZone)}.`
          : `Data from ${names} is stale: no successful sync has completed yet.`}{" "}
        At-risk alerts are marked; breach alerts wait for a fresh source sync.
      </AlertDescription>
    </DismissibleAlert>
  );
}
