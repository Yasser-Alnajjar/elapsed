import type { ReactNode } from "react";
import { formatPriorityTier } from "@/lib/format";
import { PRIORITY_TIER_STYLES } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

/**
 * A ticket's severity chip, tinted by its P1–P4 tier ("P1 - urgent" by
 * default). Renders nothing for a priority with no tier.
 */
export function PriorityTierChip({
  priority,
  className,
  children,
}: {
  priority: string | null | undefined;
  className?: string;
  children?: ReactNode;
}) {
  const tier = formatPriorityTier(priority ?? null);
  if (!tier) return null;

  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 font-mono text-xxs font-semibold tracking-wider uppercase",
        PRIORITY_TIER_STYLES[tier].chip,
        className,
      )}
    >
      {children ?? `${tier} - ${priority}`}
    </span>
  );
}
