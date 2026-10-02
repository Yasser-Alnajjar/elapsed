import {
  AdminPanel,
  MonoLabel,
  SectionTitle,
  Tag,
  ZeroState,
} from "@/components/admin/admin-ui";
import { formatUtcTimestamp } from "@/lib/admin-format";
import { formatCommitmentKind } from "@/lib/format";
import type { AdminAlertFailureRow } from "@/lib/types/admin";
import { BellRing } from "lucide-react";

interface AlertDeliverySectionProps {
  sent24h: number;
  failing24h: number;
  failingAlertCount: number;
  failures: AdminAlertFailureRow[];
}

/** Alert delivery over the last 24 hours, and the alerts that no channel could deliver. Ticket ids only, never ticket content. */
export function AlertDeliverySection({
  sent24h,
  failing24h,
  failingAlertCount,
  failures,
}: AlertDeliverySectionProps) {
  return (
    <section aria-labelledby="alert-delivery" className="flex flex-col gap-3">
      <SectionTitle
        icon={BellRing}
        tone={failingAlertCount > 0 ? "danger" : "success"}
        title={<span id="alert-delivery">Alert delivery health</span>}
        description={`${sent24h} sent and ${failing24h} failing in the last 24 h.`}
        aside={
          <div className="flex items-center gap-2 font-mono text-xxs font-semibold tabular-nums">
            <span className="bg-surface-raised text-foreground rounded border border-transparent px-2 py-1">
              {sent24h + failing24h} attempted
            </span>
            <span className="border-success/30 bg-success/10 text-success rounded border px-2 py-1">
              {sent24h} sent
            </span>
            <span
              className={
                failing24h > 0
                  ? "border-error/35 bg-error/10 text-error rounded border px-2 py-1"
                  : "bg-surface-raised text-muted-foreground rounded border border-transparent px-2 py-1"
              }
            >
              {failing24h} failing
            </span>
          </div>
        }
      />

      {failures.length === 0 ? (
        <ZeroState title="No failed deliveries">
          No alert deliveries are currently failing.
        </ZeroState>
      ) : (
        <AdminPanel className="overflow-hidden">
          <ul className="divide-border divide-y">
            {failures.map((failure) => (
              <li
                key={`${failure.commitmentId}:${failure.threshold}`}
                className="grid gap-x-6 gap-y-2 px-4 py-3.5 md:grid-cols-[minmax(0,12rem)_minmax(0,10rem)_minmax(0,1fr)]"
              >
                <div className="flex flex-col gap-1">
                  <MonoLabel>Ticket</MonoLabel>
                  <span className="text-foreground font-mono text-sm font-semibold">
                    #{failure.externalId}
                  </span>
                </div>
                <div className="flex flex-col items-start gap-1">
                  <MonoLabel>Commitment</MonoLabel>
                  <Tag tone="warning">
                    {formatCommitmentKind(
                      failure.kind as Parameters<
                        typeof formatCommitmentKind
                      >[0],
                    )}{" "}
                    @ {failure.threshold}%
                  </Tag>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <MonoLabel>
                    {failure.attempts} attempt
                    {failure.attempts === 1 ? "" : "s"} · first failed{" "}
                    {formatUtcTimestamp(failure.firstFailedAt)}
                  </MonoLabel>
                  <p className="text-error font-mono text-xs leading-5 break-words">
                    {failure.error}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {failingAlertCount > failures.length && (
            <p className="border-border text-foreground-subtle border-t px-4 py-2.5 font-mono text-xxs">
              +{failingAlertCount - failures.length} more not shown.
            </p>
          )}
        </AdminPanel>
      )}
    </section>
  );
}
