import type { FilterOption } from "@/components/shared/filter-group";
import type { PriorityTier } from "@/lib/format";
import { COMMITMENT_STATUS_STYLES } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

export type StatusFilter = "all" | "breached" | "at_risk" | "on_track" | "met";

export type OpenFilter = "all" | "open" | "closed";

export type LinkFilter = "all" | "linked" | "unlinked";

export type SeverityFilter = "all" | PriorityTier;

export const STATUS_FILTERS: FilterOption<StatusFilter>[] = [
  { value: "all", label: "All Cases" },
  ...(
    [
      ["at_risk", "At Risk"],
      ["breached", "Breached"],
      ["on_track", "On Track"],
      ["met", "Met"],
    ] as const
  ).map(([status, label]) => ({
    value: status,
    label,
    tone: COMMITMENT_STATUS_STYLES[status].text,
    dot: cn(
      COMMITMENT_STATUS_STYLES[status].fill,
      status === "at_risk" && "animate-pulse",
    ),
    badge: `bg-surface-container-lowest ${COMMITMENT_STATUS_STYLES[status].text}`,
  })),
];

export const OPEN_FILTERS: FilterOption<OpenFilter>[] = [
  {
    value: "all",
    label: "All",
    tone: "",
    dot: "",
    badge: "",
  },
  {
    value: "open",
    label: "Open",
    tone: "text-primary",
    dot: "bg-primary",
    badge: "bg-surface-container-lowest text-primary",
  },
  {
    value: "closed",
    label: "Closed",
    tone: "text-tertiary",
    dot: "bg-tertiary",
    badge: "bg-surface-container-lowest text-tertiary",
  },
];

export const LINK_FILTERS: FilterOption<LinkFilter>[] = [
  {
    value: "all",
    label: "All",
    tone: "",
    dot: "",
    badge: "",
  },
  {
    value: "linked",
    label: "Linked",
    tone: "text-tertiary",
    dot: "bg-tertiary",
    badge: "bg-surface-container-lowest text-tertiary",
  },
  {
    value: "unlinked",
    label: "Unlinked",
    tone: "text-on-surface-variant",
    dot: "bg-outline",
    badge: "bg-surface-container-lowest text-on-surface-variant",
  },
];
