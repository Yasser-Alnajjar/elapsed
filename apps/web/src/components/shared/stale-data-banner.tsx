import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatExactTimestamp } from "@/lib/format";

/** `staleSince: null` means the integration has never completed a successful sync. */
export function StaleDataBanner({ integrations }: { integrations: { provider: string; staleSince: string | null }[] }) {
  if (integrations.length === 0) return null;
  const names = integrations.map((row) => row.provider).join(", ");
  const since = integrations.flatMap((row) => (row.staleSince ? [row.staleSince] : [])).sort()[0];
  return (
    <Alert variant="warning" className="mb-4">
      <ShieldAlert />
      <AlertDescription>
        {since
          ? `Data from ${names} is stale since ${formatExactTimestamp(since)}.`
          : `Data from ${names} is stale: no successful sync has completed yet.`}{" "}
        At-risk alerts are marked; breach alerts wait for a fresh source sync.
      </AlertDescription>
    </Alert>
  );
}
