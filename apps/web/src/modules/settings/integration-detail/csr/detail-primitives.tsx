import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TONE_DOT, TONE_TEXT } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

/** Building blocks shared by the integration detail page's sections. */

export const iconWrapper =
  "flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-primary";

export const descriptionClass = "text-sm text-on-surface-variant";

export const labelClass =
  "font-mono text-xxs font-semibold uppercase tracking-wider text-outline";

export const panelClass =
  "bg-surface-container flex flex-col gap-2 rounded-lg p-4";

export function StatusPill({
  tone,
  children,
  pulse,
}: {
  tone: "success" | "warning" | "neutral";
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "bg-surface-container-low inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xxs font-semibold uppercase tracking-wide shadow-sm",
        TONE_TEXT[tone],
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          TONE_DOT[tone],
          pulse && "animate-pulse",
        )}
      />
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "success" | "warning";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <span
        className={cn(
          "truncate font-mono text-sm font-semibold",
          tone ? TONE_TEXT[tone] : "text-on-surface",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-on-surface-variant">{hint}</span>}
    </div>
  );
}

export function SectionCard({
  icon,
  title,
  description,
  badge,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="bg-surface-container-low overflow-hidden rounded-xl border-0 shadow-sm">
      <CardHeader className="p-6 pb-0">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className={iconWrapper}>{icon}</span>
            <div>
              <CardTitle className="text-on-surface text-xl font-semibold tracking-tight">
                {title}
              </CardTitle>
              <p className="mt-1 text-xs text-on-surface-variant">
                {description}
              </p>
            </div>
          </div>
          {badge}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-6 pt-4">
        {children}
      </CardContent>
    </Card>
  );
}

export function SectionBadge({
  tone = "success",
  icon,
  children,
}: {
  tone?: "success" | "warning" | "primary" | "neutral";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "bg-surface-container inline-flex items-center gap-1.5 self-start rounded px-3 py-1 font-mono text-xxs font-semibold uppercase sm:self-auto",
        TONE_TEXT[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** A section badge's leading status dot. */
export function BadgeDot({
  tone,
  pulse,
}: {
  tone: "success" | "warning" | "neutral";
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full",
        TONE_DOT[tone],
        pulse && "animate-pulse",
      )}
    />
  );
}
