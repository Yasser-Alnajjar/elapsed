import type { AtRiskSeverityFilter } from "@/lib/types/at-risk";

/**
 * The current leg is derived from live-evaluated leg spans, not a persisted
 * field — this filter narrows only the already-fetched page of rows, never
 * round-trips to the server (performance-plan.md Phase 2 item 4).
 */
export type LegFilter =
  | "all"
  | "support"
  | "engineering"
  | "waiting_customer"
  | "unknown";

/** `severity` maps to a persisted `Case.priority`, so it's a server-side filter — see `AtRiskSeverityFilter`. */
export type SeverityFilter = AtRiskSeverityFilter;
