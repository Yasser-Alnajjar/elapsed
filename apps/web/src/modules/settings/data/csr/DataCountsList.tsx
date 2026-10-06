import type { IntegrationDataCounts } from "@/lib/types/data";
import { cn } from "@/lib/utils";
import { DATA_COUNT_LINES, formatCount } from "./data-format";

/**
 * The records an integration's backup covers and a cleanup would delete, with
 * their actual counts. Shown before either action so the scope is never a
 * surprise; zero rows are dimmed rather than hidden so it stays comparable.
 */
export function DataCountsList({ counts }: { counts: IntegrationDataCounts }) {
  return (
    <dl className="bg-surface-container grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-lg p-3 sm:grid-cols-2">
      {DATA_COUNT_LINES.map(({ key, label, hint }) => (
        <div
          key={key}
          className={cn("flex items-baseline justify-between gap-3 text-xs", counts[key] === 0 && "opacity-50")}
          title={hint}
        >
          <dt className="text-on-surface-variant">{label}</dt>
          <dd className="text-on-surface font-mono font-semibold">{formatCount(counts[key])}</dd>
        </div>
      ))}
    </dl>
  );
}
