import { BillingCaption, BillingCard, UsageBar } from "@/components/billing/billing-ui";
import { TONE_DOT, TONE_TEXT } from "@/lib/status-styles";
import type { SubscribeLimitRow } from "@/lib/types/billing-subscribe";
import { cn } from "@/lib/utils";

function LimitRow({ row }: { row: SubscribeLimitRow }) {
  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-foreground flex items-center gap-2 font-medium">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[row.tone])} />
          {row.label}
        </span>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {row.used} in use /{" "}
          <span className={cn("font-semibold", row.limit === null ? "text-foreground" : TONE_TEXT[row.tone === "primary" ? "neutral" : row.tone])}>
            {row.limit === null ? "Unlimited" : `${row.limit} allowed`}
          </span>
        </span>
      </div>
      <UsageBar percent={row.limit === null ? Math.min(100, row.used > 0 ? 100 : 0) : row.percent} tone={row.limit === null ? "success" : row.tone} className={row.limit === null ? "opacity-60" : undefined} label={`${row.label} in use`} />
      <p className="text-foreground-subtle font-mono text-[11px]">{row.note}</p>
    </li>
  );
}

/** "What changes for you": current usage against the target plan's ceilings. */
export function ChangesCard({ rows }: { rows: SubscribeLimitRow[] }) {
  return (
    <BillingCard aria-labelledby="changes-title" className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-start">
        <div>
          <h2 id="changes-title" className="text-foreground text-lg font-semibold tracking-tight">
            What changes for you
          </h2>
          <p className="text-muted-foreground text-sm">Your current usage against the target plan&apos;s limits.</p>
        </div>
        <BillingCaption className="sm:text-right">Limits apply only when adding new items</BillingCaption>
      </div>
      <ul className="divide-border divide-y">
        {rows.map((row) => (
          <LimitRow key={row.id} row={row} />
        ))}
      </ul>
    </BillingCard>
  );
}
