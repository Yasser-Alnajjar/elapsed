import { Leg, CommitmentKind, CommitmentStatus } from "@sla/core";
import type { PriorityTier } from "../format";
import type { IntegrationProvider } from "./integrations";

/**
 * A case's linked Jira/Linear/GitHub issue as surfaced to this row — only
 * ever built from an active (`unlinkedAt: null`) `CaseLink`, preferring
 * `certain` confidence when a case somehow carries more than one.
 */
export interface AtRiskLinkedIssue {
  system: IntegrationProvider;
  externalId: string;
  confidence: "certain" | "probable";
}

export interface AtRiskRowData {
  commitmentId: string;
  caseId: string;
  externalId: string;
  subject: string | null;
  /** The case's account/company, or null when the ticket has none. Never falls back to `requesterName` — a requester is not a customer. */
  customerName: string | null;
  /** The individual who submitted the ticket, or null when unknown. Independent of `customerName` — never merged with it. */
  requesterName: string | null;
  kind: CommitmentKind;
  remainingMinutes: number;
  status: CommitmentStatus;
  currentLeg: Leg;
  minutesInCurrentLeg: number;
  /** The source ticket's priority (Zendesk/Intercom), or null when unset. */
  priority: string | null;
  /** `Customer.tier`, falling back to `Case.tier` for a ticket with no linked customer. */
  tier: string | null;
  /** This commitment's target minutes, from the matched `SLAPolicyVersion` — the "Resolution (4h Max)"-style ceiling. */
  targetMinutes: number;
  /** Business-time seconds elapsed against this commitment's own clock so far (`Evaluation.elapsedSeconds`) — distinct from the leg-wall-clock sums below. */
  elapsedSeconds: number;
  /** Cumulative minutes this case has spent in the support leg so far, via `sumLegMinutes`. */
  supportLegMinutes: number;
  /** Cumulative minutes this case has spent in the engineering leg so far, via `sumLegMinutes`. */
  engineeringLegMinutes: number;
  /** Cumulative minutes this case has spent waiting for the customer, via `sumLegMinutes`. */
  waitingCustomerLegMinutes: number;
  /** The case's support-side assignee (`Case.assigneeName`), or null when unassigned. */
  supportAssigneeName: string | null;
  /** This case's active Jira/Linear/GitHub correlation, or null when none exists yet. */
  linkedIssue: AtRiskLinkedIssue | null;
}

export type AtRiskSeverityFilter = "all" | PriorityTier;

export interface AtRiskParams {
  page: number;
  pageSize: number;
  severity: AtRiskSeverityFilter;
  q: string;
}

export interface AtRiskCounts {
  /**
   * Org-wide, filter-independent — same `getCounts`-style query as
   * `case-list-data.ts`, computed from persisted `Case.priority` only (no
   * events, no evaluation).
   */
  severity: Record<AtRiskSeverityFilter, number>;
}

/** A bounded, narrow-select sample used only for the KPI tiles' "e.g. Acme #1234" detail text — never a source of row data. */
export interface AtRiskThreatSample {
  externalId: string;
  customerName: string | null;
}

export interface AtRiskPageData {
  asOf: string;
  /** Live-evaluated rows for this page only (performance-plan.md Phase 2 item 4) — ordered by `dueAt, id`, the same order the UI advertises. */
  rows: AtRiskRowData[];
  page: number;
  pageSize: number;
  /** How many pages the active severity/search filters produce. */
  pageCount: number;
  /** How many commitments match the active severity/search filters — what pagination is scoped to. */
  rowCount: number;
  /** Org-wide count of every open, non-cancelled at-risk/breached/on-track commitment, independent of the active filters — the header's headline figure. */
  totalCount: number;
  /** Org-wide, filter-independent. */
  breachedCount: number;
  /** Org-wide, filter-independent. */
  linkedCertainCount: number;
  /** Org-wide count of candidates whose persisted `dueAt` is under the "Immediate Threat" threshold — a `dueAt`-based approximation of live `remainingMinutes`, the same one `liveCommitment` uses in `case-list-data.ts`. */
  immediateThreatCount: number;
  immediateThreatSample: AtRiskThreatSample[];
  /** Org-wide count of candidates whose persisted `dueAt` falls in the "Elevated Risk" band. */
  elevatedRiskCount: number;
  elevatedRiskSample: AtRiskThreatSample[];
  counts: AtRiskCounts;
}
