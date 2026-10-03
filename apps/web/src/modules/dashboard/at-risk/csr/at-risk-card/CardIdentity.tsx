import Link from "next/link";
import { PriorityTierChip } from "@/components/shared/priority-tier-chip";
import { formatCommitmentKind, formatLinkedSystemShort } from "@/lib/format";
import type { CommitmentStatusStyle } from "@/lib/status-styles";
import type { AtRiskRowData } from "@/lib/types/at-risk";
import { cn } from "@/lib/utils";

/** Status stripe, severity, ticket ⇄ issue ids, customer / subject and requester. */
export function CardIdentity({
  row,
  href,
  statusStyle,
}: {
  row: AtRiskRowData;
  href: string;
  statusStyle: CommitmentStatusStyle;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 lg:items-center">
      <div
        aria-hidden
        className={cn("w-2 shrink-0 self-stretch rounded", statusStyle.fill)}
      />

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityTierChip priority={row.priority} />

          <Link
            href={href}
            className="rounded bg-surface-container-lowest px-2 py-0.5 font-mono text-xs text-primary hover:underline"
          >
            #{row.externalId}
          </Link>

          {row.linkedIssue && (
            <>
              <span
                aria-hidden
                className="font-mono text-xs text-muted-foreground"
              >
                ↔
              </span>

              <span className="rounded bg-surface-container-lowest px-2 py-0.5 font-mono text-xs text-secondary">
                {formatLinkedSystemShort(row.linkedIssue.system)}-
                {row.linkedIssue.externalId}
              </span>
            </>
          )}

          <span className="text-xxs font-medium uppercase tracking-wider text-muted-foreground">
            {row.tier ?? formatCommitmentKind(row.kind)}
          </span>
        </div>

        <h2 className="truncate text-sm font-semibold text-foreground">
          {row.customerName ?? "Unknown customer"}
          {row.subject && (
            <span className="font-normal text-muted-foreground">
              {" — "}
              {row.subject}
            </span>
          )}
        </h2>

        {row.requesterName && (
          <p className="text-xs text-muted-foreground">
            Requested by {row.requesterName}
          </p>
        )}
      </div>
    </div>
  );
}
