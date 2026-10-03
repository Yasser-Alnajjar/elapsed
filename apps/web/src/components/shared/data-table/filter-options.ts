import { formatPriorityTierName, type PriorityTier } from "@/lib/format";
import { PRIORITY_TIER_STYLES } from "@/lib/status-styles";

export type FilterOption<T extends string> = {
  value: T;
  label: string;
  /** Text colour of the option (it also tints the active background via `bg-current`). */
  tone?: string;
  dot?: string;
  /** A leading status glyph (`●`, `▲`, `✕`). */
  glyph?: string;
  /** Count pill colours while the option is inactive. */
  badge?: string;
};

/** Severity (P1–P4) options, shared by every list that filters on ticket priority. */
export const PRIORITY_TIER_FILTER_OPTIONS: FilterOption<"all" | PriorityTier>[] =
  [
    { value: "all", label: "All" },
    ...(["P1", "P2", "P3", "P4"] as const).map((tier) => ({
      value: tier,
      label: `${tier} ${formatPriorityTierName(tier)}`,
      tone: PRIORITY_TIER_STYLES[tier].text,
      dot: PRIORITY_TIER_STYLES[tier].dot,
      badge: PRIORITY_TIER_STYLES[tier].chip,
    })),
  ];
