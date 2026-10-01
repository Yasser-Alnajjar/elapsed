import type { CommitmentKind, CommitmentStatus, Leg } from "@sla/core";
import type { IntegrationProvider } from "./integrations";

/**
 * A case's linked Jira/Linear issue as surfaced to a dashboard-scoped row —
 * the same `CaseLink` concept case-detail already renders, narrowed to what
 * a list row needs. Only ever built from an active (`unlinkedAt: null`) link.
 */
export interface LinkedIssueRef {
  system: IntegrationProvider;
  externalId: string;
  confidence: "certain" | "probable";
  method: "official_link" | "remote_link" | "pattern" | "manual";
}

export interface AtRiskRow {
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
  // The dashboard reconstruction's own fields below are optional: only
  // `dashboard-data.ts`'s `getDashboardData` populates them today.
  // `at-risk-data.ts`'s `getAtRiskData` (the separate /at-risk route) is out
  // of scope for that reconstruction and doesn't set them — `undefined`
  // there is accurate, not a stand-in for a real value.
  /** The source ticket's priority (Zendesk/Intercom), or null when unset. */
  priority?: string | null;
  /** `Customer.tier`, falling back to `Case.tier` for a ticket with no linked customer. */
  tier?: string | null;
  /** This commitment's target minutes, from the matched `SLAPolicyVersion` — the "Resolution (4h Max)"-style ceiling. */
  targetMinutes?: number;
  /** Cumulative minutes this case has spent in the support leg, via `sumLegMinutes` — same primitive the worker uses. */
  supportLegMinutes?: number;
  /** Cumulative minutes this case has spent in the engineering leg, via `sumLegMinutes`. */
  engineeringLegMinutes?: number;
  /** This case's active Jira/Linear correlation, or null when none exists yet. */
  linkedIssue?: LinkedIssueRef | null;
}

/** The dashboard's "Total Escalated" KPI: cases whose leg history touches engineering at all within the reporting period, cross-referenced against link confidence. */
export interface TotalEscalatedSummary {
  /** Cases closed within the period whose derived leg spans include at least one engineering span. */
  count: number;
  /** Of `count`, how many have an active `certain`-confidence Jira/Linear link. */
  linkedCertain: number;
  /** `count - linkedCertain` — probable-confidence links and cases with no active link at all, grouped for the footer's two-way split. */
  unlinkedOrOther: number;
}

/** The "30-Day Attribution Ledger" panel: period-scoped leg-hour totals and linking precision, computed over the same case set as `TotalEscalatedSummary`. */
export interface AttributionLedger {
  supportLegHours: number;
  engineeringLegHours: number;
  waitingCustomerLegHours: number;
  /** `linkedCertain / totalTrackedCases`, or null when there are no tracked cases yet. */
  linkingPrecisionPercent: number | null;
  directMatches: number;
  unlinkedOrStandalone: number;
  /** Same instant as `DashboardData.asOf` — the ledger is only ever as fresh as the whole dashboard's snapshot. */
  auditTimestamp: string;
}

export interface BreachedCaseRow {
  commitmentId: string;
  caseId: string;
  externalId: string;
  customerName: string | null;
  kind: CommitmentKind;
  subject: string | null;
}

/** The dashboard's "breached this period" KPI tile and per-kind breakdown — counts only, since neither ever renders an individual row (Phase 1 quick win: the KPI is a count, not a table). */
export interface BreachedThisPeriodSummary {
  total: number;
  byKind: Partial<Record<CommitmentKind, number>>;
}

/** A customer/kind pair whose most recent cycle times statistically depart from their own history (roadmap step 25). */
export interface CycleTimeAnomalyRow {
  customerName: string;
  kind: CommitmentKind;
  baselineMedianMinutes: number;
  baselineCount: number;
  recentMedianMinutes: number;
  recentCount: number;
  modifiedZScore: number;
  direction: "slower" | "faster";
}

/** Distribution of cases by worst commitment status, for the SLA Compliance chart (roadmap: Project Analytics). */
export interface SlaComplianceBreakdown {
  metSla: number;
  atRisk: number;
  breached: number;
  total: number;
}

/** One day's new-breach count for the Breaches Over Time chart. */
export interface BreachesOverTimePoint {
  date: string;
  count: number;
}

/** Breach count for one leg, for the Breaches by Stage chart. */
export interface BreachesByStageRow {
  leg: Leg;
  count: number;
}

/** One day's new-breach count, split by which leg owned the case at the moment it breached — `count` on `BreachesOverTimePoint` collapsed into two series. Support/waiting/unknown all fold into `supportCount`: the dashboard's chart distinguishes only "in engineering" vs. "not." */
export interface BreachesOverTimeLegPoint {
  date: string;
  supportCount: number;
  engineeringCount: number;
}

/** One day's trailing-7-day compliance rate among commitments closed in that window — null for a day with nothing closed in its trailing window, a real gap rather than a fabricated flat line. */
export interface ComplianceTrendPoint {
  date: string;
  compliancePercent: number | null;
}

export interface ProjectAnalyticsData {
  compliance: SlaComplianceBreakdown;
  breachesOverTime: BreachesOverTimePoint[];
  breachesOverTimeByLeg: BreachesOverTimeLegPoint[];
  breachesByStage: BreachesByStageRow[];
  complianceTrend: ComplianceTrendPoint[];
}

/** On track / at risk / breached counts for one `CommitmentKind`, among currently-open commitments only (Phase 6.1) — closed commitments already have an outcome, not a live status worth breaking out here. */
export interface CommitmentKindHealth {
  kind: CommitmentKind;
  onTrack: number;
  atRisk: number;
  breached: number;
}

/** An open case (not deleted, not closed) with zero commitments — the commitment pipeline found no active `SLAPolicyVersion` matching its attributes, so it is silently unmonitored (Phase 6.2). Mirrors `SlaImportSummary.casesWithNoMatchingPolicy`'s count with the actual rows behind it. */
export interface UnmatchedCaseRow {
  caseId: string;
  externalId: string;
  subject: string | null;
  customerName: string | null;
  openedAt: string;
}

/** One connected-or-attempted integration's health, for the dashboard's "silently not being monitored" panel (Phase 6.3). Only providers with a row at all are included — a provider never connected has nothing to show here (it's covered by onboarding, not this panel). */
export interface IntegrationHealthRow {
  provider: IntegrationProvider;
  reauthRequired: boolean;
  permissionDenied: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

/** An alert that every configured channel has failed to deliver at least once and is still unresolved (Phase 6.4) — see `NotificationFailure`. Retried every worker cycle until it succeeds or the underlying commitment closes. */
export interface FailedAlertRow {
  commitmentId: string;
  caseId: string;
  externalId: string;
  subject: string | null;
  kind: CommitmentKind;
  threshold: number;
  error: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
}

export interface DashboardData {
  asOf: string;
  organizationName: string | null;
  periodDays: number;
  atRisk: AtRiskRow[];
  atRiskOverflowCount: number;
  breachedThisPeriod: BreachedThisPeriodSummary;
  /** Breached-and-closed count for the prior 30-day period, for the KPI tile's trend arrow — null only when the underlying query hasn't run (never fabricated as 0). */
  breachedPreviousPeriodCount: number | null;
  totalEscalated: TotalEscalatedSummary;
  attributionLedger: AttributionLedger;
  compliance: { current: number | null; previous: number | null };
  cycleTimeAnomalies: CycleTimeAnomalyRow[];
  analytics: ProjectAnalyticsData;
  /** Phase 6.1: on-track/at-risk/breached counts per commitment kind, among open commitments. Always carries all three `CommitmentKind`s, even when a kind has no open commitments (all zero). */
  healthByKind: CommitmentKindHealth[];
  /** Phase 6.2, capped like the other lists (`unmatchedOverflowCount` reports the rest). */
  unmatchedCases: UnmatchedCaseRow[];
  unmatchedOverflowCount: number;
  /** Phase 6.3. Only providers with an `Integration` row for this organization. */
  integrationHealth: IntegrationHealthRow[];
  /** Phase 6.4, capped like the other lists (`failedAlertsOverflowCount` reports the rest). */
  failedAlerts: FailedAlertRow[];
  failedAlertsOverflowCount: number;
}
