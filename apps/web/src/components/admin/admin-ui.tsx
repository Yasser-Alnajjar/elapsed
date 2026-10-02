import { CheckCircle2, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks of the platform-admin console: the "operations
 * console" look from the Stitch admin design (dense surfaces, tabular
 * monospace, tiny uppercase labels). Presentational only, no data and no
 * "use client", so server and client components can both use them.
 *
 * Colours are theme tokens (`bg-card`, `text-foreground-subtle`, ...), never
 * the design's hex values, so the console follows the light/dark toggle.
 */

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning-text",
  danger: "text-error",
};

export const TONE_SURFACE: Record<Tone, string> = {
  neutral: "border-border bg-surface-raised text-muted-foreground",
  primary: "border-primary/30 bg-primary/10 text-primary",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/35 bg-warning/10 text-warning-text",
  danger: "border-error/35 bg-error/10 text-error",
};

/** The tiny uppercase mono caption used above values and as column headings. */
export function MonoLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] leading-3 font-semibold tracking-[0.08em] text-foreground-subtle uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A solid surface card. */
export function AdminPanel({
  children,
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"section"> & {
  tone?: "neutral" | "warning" | "danger";
}) {
  return (
    <section
      className={cn(
        "bg-card rounded-lg border",
        tone === "neutral" && "border-border",
        tone === "warning" && "border-warning/35",
        tone === "danger" && "border-error/35",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  className?: string;
}) {
  const color = {
    neutral: "bg-foreground-subtle",
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-error",
  }[tone];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        color,
        pulse && "animate-pulse",
        className,
      )}
    />
  );
}

/** Small bordered mono tag: `ticket source`, `ten_a1b2c3`, `HTTP 503`. */
export function Tag({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
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
      {children}
    </span>
  );
}

/** A dot, a caption and (optionally) a right-aligned aside: the heading of a panel section. */
export function PanelHeading({
  children,
  tone = "primary",
  aside,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="flex items-center gap-1.5">
        <StatusDot tone={tone} />
        <MonoLabel>{children}</MonoLabel>
      </span>
      {aside}
    </div>
  );
}

/** Section title inside a long page: big mono-ish heading with a one-line description and optional badges. */
export function SectionTitle({
  icon: Icon,
  title,
  description,
  badges,
  aside,
  tone = "primary",
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  badges?: ReactNode;
  aside?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          {Icon ? (
            <Icon
              className={cn("size-4 shrink-0", TONE_TEXT[tone])}
              aria-hidden
            />
          ) : (
            <StatusDot tone={tone} className="size-2" />
          )}
          <h2 className="text-foreground text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {badges}
        </div>
        {description && (
          <p className="text-muted-foreground mt-0.5 max-w-3xl text-sm leading-5">
            {description}
          </p>
        )}
      </div>
      {aside}
    </div>
  );
}

/** Page title block: optional breadcrumb, a title with an inline mono suffix, a description, and a right-hand slot. */
export function PageHeader({
  breadcrumb,
  title,
  suffix,
  description,
  aside,
}: {
  breadcrumb?: ReactNode;
  title: ReactNode;
  suffix?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {breadcrumb && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {breadcrumb}
          </div>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">
            {title}
          </h1>
          {suffix && (
            <span className="text-foreground-subtle font-mono text-sm font-medium">
              {suffix}
            </span>
          )}
        </div>
        {description && (
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-5">
            {description}
          </p>
        )}
      </div>
      {aside && <div className="shrink-0 lg:max-w-md">{aside}</div>}
    </header>
  );
}

/** The calm "this is recorded" callout. `tone` follows how loud the page wants it to be. */
export function AuditNotice({
  label,
  children,
  tone = "warning",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  tone?: "warning" | "primary";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3.5 py-2.5",
        tone === "warning"
          ? "border-warning/30 bg-warning/[0.07]"
          : "border-primary/25 bg-primary/[0.07]",
        className,
      )}
    >
      <ShieldCheck
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "warning" ? "text-warning-text" : "text-primary",
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <span
          className={cn(
            "font-mono text-[10px] font-semibold tracking-[0.08em] uppercase",
            tone === "warning" ? "text-warning-text" : "text-primary",
          )}
        >
          {label}
        </span>
        <p className="text-muted-foreground mt-0.5 text-xs leading-4">
          {children}
        </p>
      </div>
    </div>
  );
}

/** A label-over-value pair. `mono` renders the value in tabular monospace (durations, ids, timestamps). */
export function Fact({
  label,
  children,
  mono = false,
  tone,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <dt>
        <MonoLabel>{label}</MonoLabel>
      </dt>
      <dd
        className={cn(
          "text-foreground min-w-0 text-sm break-words",
          mono && "font-mono text-xs tabular-nums",
          tone && TONE_TEXT[tone],
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** A headline number with a mono caption, for the summary strips. */
export function StatTile({
  label,
  value,
  tone,
  detail,
  icon: Icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
  detail?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <AdminPanel className={cn("flex flex-col gap-2 p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <MonoLabel>{label}</MonoLabel>
        {Icon && <Icon className="text-foreground-subtle size-4" aria-hidden />}
      </div>
      <p
        className={cn(
          "font-mono text-3xl leading-none font-bold tabular-nums",
          tone ? TONE_TEXT[tone] : "text-foreground",
        )}
      >
        {value}
      </p>
      {detail && (
        <div className="text-muted-foreground text-xs leading-4">{detail}</div>
      )}
    </AdminPanel>
  );
}

/** The friendly "nothing is wrong" state. */
export function ZeroState({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-success/25 bg-success/[0.06] px-4 py-3.5",
        className,
      )}
    >
      <CheckCircle2
        className="text-success mt-0.5 size-5 shrink-0"
        aria-hidden
      />
      <div>
        <p className="text-foreground text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-sm leading-5">
          {children}
        </p>
      </div>
    </div>
  );
}

/** A count in a pill, tinted red when non-zero (the "N things need you" badge). */
export function CountBadge({
  count,
  tone = "danger",
  children,
}: {
  count: number;
  tone?: Tone;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-xxs leading-3 font-semibold",
        TONE_SURFACE[tone],
      )}
    >
      <span className="tabular-nums">{count}</span>
      {children && <span>{children}</span>}
    </span>
  );
}
