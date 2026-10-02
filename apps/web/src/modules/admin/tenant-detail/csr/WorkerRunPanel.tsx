import { Cpu } from "lucide-react";
import { AdminPanel, MonoLabel, StatusDot } from "@/components/admin/admin-ui";
import { formatSpan, formatUtcTimestamp } from "@/lib/admin-format";
import type { AdminWorkRunSummary } from "@/lib/types/admin";
import { cn } from "@/lib/utils";

/** This organization's own most recent worker run. Scheduling is per organization, so there is no global tick to show. */
export function WorkerRunPanel({ work }: { work: AdminWorkRunSummary | null }) {
  return (
    <AdminPanel className="overflow-hidden">
      <div className="bg-surface-raised border-border flex items-center gap-2.5 border-b px-4 py-3">
        <Cpu className="text-primary size-4" aria-hidden />
        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Worker run
        </h2>
      </div>

      {work ? (
        <dl className="flex flex-col gap-3 p-4">
          <Row label="Last started">
            {formatUtcTimestamp(work.lastStartedAt)}
          </Row>
          <Row label="Last finished">
            {formatUtcTimestamp(work.lastFinishedAt)}
            {work.lastRunDurationMs !== null && (
              <span className="text-foreground-subtle block text-xxs">
                took {formatSpan(work.lastRunDurationMs)}
              </span>
            )}
          </Row>
          <Row label="Next run due">
            {formatUtcTimestamp(work.activeNextDueAt)}
          </Row>
          <Row label="Consecutive failed runs">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 font-semibold",
                work.consecutiveFailures > 0 ? "text-error" : "text-success",
              )}
            >
              <StatusDot
                tone={work.consecutiveFailures > 0 ? "danger" : "success"}
              />
              {work.consecutiveFailures}
            </span>
          </Row>
          {work.lastError && (
            <div className="border-error/30 bg-error/[0.07] rounded border px-3 py-2">
              <MonoLabel className="text-error">Last error</MonoLabel>
              <p className="text-foreground mt-1 font-mono text-xs leading-5 break-words">
                {work.lastError}
              </p>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-muted-foreground p-4 text-sm">
          The worker has not scheduled this organization yet.
        </p>
      )}
    </AdminPanel>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt>
        <MonoLabel>{label}</MonoLabel>
      </dt>
      <dd className="text-foreground text-right font-mono text-xs tabular-nums">
        {children}
      </dd>
    </div>
  );
}
