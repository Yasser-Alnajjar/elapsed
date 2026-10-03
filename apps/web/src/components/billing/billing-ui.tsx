import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { TONE_DOT, TONE_SURFACE, TONE_TEXT } from "@/lib/status-styles";
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_TONES,
  type BillingTone,
  type InvoiceStatus,
  type SubscriptionStatus,
} from "@/lib/types/billing";
import { cn } from "@/lib/utils";

/**
 * Presentational building blocks of the billing screens (tenant `/billing`
 * and the admin billing console): the Stitch billing design's dense surfaces,
 * tiny uppercase mono captions and tinted status pills. No data and no
 * "use client", so server and client components can both use them.
 *
 * Colours are theme tokens, never the design's hex values, so billing follows
 * the light/dark toggle like the rest of the app.
 */

/** A solid surface card. */
export function BillingCard({
  children,
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("bg-card border-border rounded-lg border", className)}
      {...props}
    >
      {children}
    </section>
  );
}

/** The tiny uppercase mono caption above values, in table heads and card corners. */
export function BillingCaption({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-foreground-subtle font-mono text-[10px] leading-3 font-semibold tracking-[0.08em] uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A tinted uppercase mono pill with an optional dot or icon: `● ACTIVE`, `✓ VALID`. */
export function BillingPill({
  tone,
  children,
  dot = false,
  pulse = false,
  icon: Icon,
  className,
  title,
}: {
  tone: BillingTone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  icon?: LucideIcon;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] leading-3 font-semibold tracking-[0.06em] whitespace-nowrap uppercase",
        TONE_SURFACE[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            TONE_DOT[tone],
            pulse && "animate-pulse",
          )}
        />
      )}
      {Icon && <Icon aria-hidden className="size-3 shrink-0" />}
      {children}
    </span>
  );
}

/** A thin progress track. `percent` is clamped by the caller (see `percentOf`). */
export function UsageBar({
  percent,
  tone = "primary",
  className,
  label,
}: {
  percent: number;
  tone?: BillingTone;
  className?: string;
  /** Accessible name; the bar is a meter. */
  label: string;
}) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "bg-surface-container h-1.5 w-full overflow-hidden rounded-full",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", TONE_DOT[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Usage tone by how full a quota is: calm, then amber from 80%, red at the limit. */
export function quotaTone(percent: number, calm: BillingTone = "primary"): BillingTone {
  if (percent >= 100) return "danger";
  if (percent >= 80) return "warning";
  return calm;
}

export function SubscriptionStatusPill({
  status,
  className,
}: {
  status: SubscriptionStatus;
  className?: string;
}) {
  const tone = SUBSCRIPTION_STATUS_TONES[status];
  return (
    <BillingPill
      tone={tone}
      dot
      pulse={status === "active" || status === "past_due"}
      className={className}
    >
      {SUBSCRIPTION_STATUS_LABELS[status]}
    </BillingPill>
  );
}

const INVOICE_STATUS_ICONS: Record<InvoiceStatus, LucideIcon> = {
  paid: CheckCircle2,
  open: Clock,
  failed: AlertCircle,
  refunded: RotateCcw,
  void: CircleDashed,
};

export function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  return (
    <BillingPill
      tone={INVOICE_STATUS_TONES[status]}
      icon={INVOICE_STATUS_ICONS[status]}
      className="rounded-full px-2"
    >
      {INVOICE_STATUS_LABELS[status]}
    </BillingPill>
  );
}

/** A label/value row on a faint raised strip, used in the plan and payment cards. */
export function BillingFactRow({
  label,
  children,
  tone,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  tone?: BillingTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-surface-raised/50 flex items-center justify-between gap-3 rounded px-2 py-1 text-xs",
        className,
      )}
    >
      <dt className="text-foreground-subtle">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right font-mono font-medium tabular-nums",
          tone ? TONE_TEXT[tone] : "text-foreground",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
