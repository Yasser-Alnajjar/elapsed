import { AlertCircle, BadgeCheck, Ban, FileText, Landmark } from "lucide-react";
import { Tag } from "@/components/admin/admin-ui";
import { BillingPill, quotaTone } from "@/components/billing/billing-ui";
import { formatBillingDate, formatCount, formatRate, percentOf } from "@/lib/billing-format";
import { TONE_DOT, TONE_TEXT } from "@/lib/status-styles";
import type { AdminBillingTenantRow, BillingNote } from "@/lib/types/admin-billing";
import { cn } from "@/lib/utils";

/** The cells of one tenant billing row, split out so the table reads as its columns. */

const NOTE = "font-mono text-[10px] leading-4";

function Note({ note }: { note: BillingNote }) {
  return <span className={cn(NOTE, note.tone === "neutral" ? "text-foreground-subtle" : TONE_TEXT[note.tone])}>{note.text}</span>;
}

const AVATAR_TONE: Record<AdminBillingTenantRow["status"], string> = {
  active: "text-primary",
  past_due: "text-warning-text",
  trialing: "text-tertiary",
  cancelled: "text-foreground-subtle",
  internal: "text-foreground-subtle",
};

export function TenantCell({ row }: { row: AdminBillingTenantRow }) {
  const cancelled = row.status === "cancelled";
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className={cn("bg-surface-overlay flex size-7 shrink-0 items-center justify-center rounded font-mono text-base font-bold", AVATAR_TONE[row.status])}>
        {row.name.charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate font-mono text-sm font-semibold transition-colors", cancelled ? "text-muted-foreground line-through" : "text-foreground group-hover:text-primary")}>
            {row.name}
          </span>
          {row.tag && <Tag tone={row.tag.tone}>{row.tag.label}</Tag>}
        </span>
        <span className="text-muted-foreground truncate font-mono text-[10px]">
          {row.id}
          {row.ownerEmail && ` · ${row.ownerEmail}`}
        </span>
      </div>
    </div>
  );
}

export function PlanCell({ row }: { row: AdminBillingTenantRow }) {
  const enterprise = row.tier === "enterprise";
  const muted = row.tier === "none" || row.status === "cancelled";
  return (
    <span
      className={cn(
        "bg-surface-raised inline-flex w-max items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-semibold",
        enterprise ? "text-primary" : muted ? "text-foreground-subtle" : "text-foreground",
      )}
    >
      {enterprise && <BadgeCheck aria-hidden className="size-3" />}
      {row.planLabel}
    </span>
  );
}

export function StateCell({ row }: { row: AdminBillingTenantRow }) {
  switch (row.status) {
    case "active":
      return (
        <BillingPill tone="success" dot>
          Active
        </BillingPill>
      );
    case "past_due":
      return (
        <BillingPill tone="danger" icon={AlertCircle} className="whitespace-normal">
          Past due{row.overdueDays !== null && ` (${row.overdueDays}d)`}
        </BillingPill>
      );
    case "trialing":
      return <BillingPill tone="warning">▲ Trial{row.trialDaysLeft !== null && ` (${row.trialDaysLeft}d left)`}</BillingPill>;
    case "internal":
      return <BillingPill tone="neutral">● Internal</BillingPill>;
    default:
      return (
        <BillingPill tone="neutral" icon={Ban}>
          Cancelled
        </BillingPill>
      );
  }
}

export function SeatsCell({ row }: { row: AdminBillingTenantRow }) {
  const cap = row.seats.licensed ?? row.seats.planLimit;
  const percent = percentOf(row.seats.used, cap);
  const tone = cap === null ? "neutral" : quotaTone(percent);
  return (
    <div className="flex w-28 flex-col gap-1">
      <div className="text-foreground flex justify-between font-mono text-[10px] tabular-nums">
        <span>
          {row.seats.used} / {cap ?? "∞"}
        </span>
        <span className={percent >= 80 ? cn("font-semibold", TONE_TEXT[tone]) : "text-foreground-subtle"}>{cap === null ? "—" : `${percent}%`}</span>
      </div>
      <div className="bg-surface-raised h-1.5 w-full overflow-hidden rounded">
        <div className={cn("h-full", TONE_DOT[tone])} style={{ width: `${cap === null ? 0 : percent}%` }} />
      </div>
    </div>
  );
}

export function RateCell({ row }: { row: AdminBillingTenantRow }) {
  const pastDue = row.status === "past_due";
  const quiet = row.status !== "active" && !pastDue;
  return (
    <div className="flex flex-col">
      <span className={cn("font-mono text-xs font-bold whitespace-nowrap tabular-nums", pastDue ? "text-error" : quiet ? "text-muted-foreground" : "text-foreground")}>
        {row.rateCents === null ? (row.hasSubscription ? "Custom" : "—") : formatRate(row.rateCents, "month")}
      </span>
      <Note note={row.rateNote} />
    </div>
  );
}

export function NextBillingCell({ row }: { row: AdminBillingTenantRow }) {
  if (row.overdueDays !== null) {
    return (
      <div className="flex flex-col">
        <span className="text-error font-mono text-xs font-bold tabular-nums">OVERDUE ({row.overdueDays}d)</span>
        <Note note={row.nextBillingNote} />
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <span className={cn("font-mono text-xs whitespace-nowrap tabular-nums", row.nextBillingAt ? "text-foreground" : "text-foreground-subtle")}>{formatBillingDate(row.nextBillingAt)}</span>
      <Note note={row.nextBillingNote} />
    </div>
  );
}

/** How this tenant pays: by direct invoice (no provider yet), or not billed. */
export function PaymentCell({ row }: { row: AdminBillingTenantRow }) {
  if (!row.hasSubscription || row.status === "cancelled" || row.status === "internal") {
    return <span className="text-foreground-subtle font-mono text-[10px]">Not billed</span>;
  }
  const Icon = row.rateCents === null ? Landmark : FileText;
  return (
    <span className="text-foreground flex items-center gap-1.5 font-mono text-xs">
      <Icon aria-hidden className="text-primary size-4 shrink-0" />
      {row.rateCents === null ? "Contract" : "Direct invoice"}
    </span>
  );
}

export function IngressCell({ row }: { row: AdminBillingTenantRow }) {
  return (
    <div className="flex flex-col font-mono text-[10px]">
      <span className={cn("font-medium tabular-nums", row.ingress24h === 0 ? "text-foreground-subtle" : "text-foreground")}>{formatCount(row.ingress24h)} events</span>
      <span className="text-foreground-subtle">Unmetered</span>
    </div>
  );
}
