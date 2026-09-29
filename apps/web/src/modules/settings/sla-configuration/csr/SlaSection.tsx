import type { ReactNode } from "react";
import { Reveal } from "@/components/shared/reveal";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Zero-padded "04h 00m" readout used by the SLA instrument panels. */
export function formatTargetClock(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);

  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}

export const monoChip =
  "bg-surface-container text-on-surface-variant rounded px-1.5 py-0.5 font-mono text-xxs";

/**
 * Shared card shell for the SLA configuration panels: icon tile, title with an
 * optional mono meta label, subtitle and a trailing header action.
 */
export function SlaSection({
  delay = 0,
  icon,
  title,
  meta,
  metaClassName,
  subtitle,
  action,
  className,
  children,
}: {
  delay?: number;
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  metaClassName?: string;
  subtitle: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Reveal delay={delay} className={className}>
      <Card className="bg-surface-container-low flex h-full flex-col gap-4 overflow-hidden rounded-xl border-0 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="bg-surface-container-highest text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
              {icon}
            </span>

            <div className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-on-surface text-lg font-medium tracking-tight">
                  {title}
                </h3>
                {meta && (
                  <span
                    className={cn(
                      "text-outline font-mono text-xxs font-semibold uppercase tracking-wider",
                      metaClassName,
                    )}
                  >
                    {meta}
                  </span>
                )}
              </div>
              <p className="text-on-surface-variant text-xs">{subtitle}</p>
            </div>
          </div>

          {action}
        </div>

        <div className="flex flex-1 flex-col gap-4">{children}</div>
      </Card>
    </Reveal>
  );
}

/** Mono uppercase column header row / label. */
export const tableHeadClass =
  "text-outline font-mono text-xxs font-semibold uppercase tracking-wider";

export function InfoNote({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-surface-container text-on-surface-variant flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-relaxed">
      <span className="text-secondary mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}
