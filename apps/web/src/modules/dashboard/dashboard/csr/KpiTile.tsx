import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A dashboard KPI card: label/icon row, a hero metric with an inline
 * qualifier, and a separate footer strip for a secondary breakdown.
 */
export function KpiTile({
  label,
  icon: Icon,
  value,
  valueClassName,
  qualifier,
  cornerFrom,
  footer,
}: {
  label: string;
  icon?: LucideIcon;
  value: ReactNode;
  valueClassName?: string;
  qualifier?: ReactNode;
  /** Tailwind `from-*` class for the decorative corner gradient blob. */
  cornerFrom?: string;
  footer: ReactNode;
}) {
  return (
    <div className="bg-surface-container-low shadow-soft group relative flex flex-col justify-between overflow-hidden rounded-xl p-4">
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-e-0 top-0 size-24 rounded-bl-full bg-gradient-to-bl to-transparent",
          cornerFrom ?? "from-primary/10",
        )}
      />
      <div className="relative">
        <div className="text-outline flex items-center justify-between">
          <span className="font-mono text-xxs font-semibold uppercase tracking-wider">
            {label}
          </span>
          {Icon && <Icon className="size-4.5" />}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span
            className={cn(
              "text-on-surface font-sans text-4xl font-semibold leading-none tracking-tight",
              valueClassName,
            )}
          >
            {value}
          </span>
          {qualifier}
        </div>
      </div>
      <div className="bg-surface-container-lowest/50 -mx-4 -mb-4 mt-4 flex items-center justify-between px-4 py-3 font-mono text-xs">
        {footer}
      </div>
    </div>
  );
}
