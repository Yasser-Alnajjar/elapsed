import type { FilterOption } from "@/components/shared/filter-group";
import { LEG_STYLES } from "@/lib/status-styles";
import type { LegFilter } from "./types";

export const AT_RISK_LEG_FILTERS: FilterOption<LegFilter>[] = [
  { value: "all", label: "All" },
  ...(
    [
      ["engineering", "Engineering Leg"],
      ["support", "Support Leg"],
    ] as const
  ).map(([leg, label]) => ({
    value: leg,
    label,
    tone: LEG_STYLES[leg].text,
    dot: LEG_STYLES[leg].fill,
    badge: `bg-surface-container-lowest ${LEG_STYLES[leg].text}`,
  })),
];
