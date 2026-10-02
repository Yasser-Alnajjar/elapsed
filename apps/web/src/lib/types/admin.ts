import type { SourceRole } from "@sla/core";
import type { PlanStatus as DbPlanStatus } from "@sla/db";
import type { IntegrationProvider } from "./integrations";
import type { LinkCoverage } from "./link-coverage";

/**
 * Platform-admin types (N4). Everything here is operator-facing: nothing in
 * this file is ever rendered to a tenant user. Only types and constants; the
 * read models live in `lib/admin-*`.
 */

// ---- Plan record (N4.3) ----------------------------------------------------

/**
 * The plans the live pricing page offers (decision D14: Starter $49, Team
 * $149, Enterprise custom, seat-based). `Organization.plan` stays a string
 * column so a later billing phase can tighten it without a migration; the
 * admin API only accepts these identifiers.
 */
export const PLAN_IDS = ["starter", "team", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PLAN_LABELS: Record<PlanId, string> = {
  starter: "Starter",
  team: "Team",
  enterprise: "Enterprise",
};

/** The list price per seat the pricing page shows; a label for the operator, never a billing source. */
export const PLAN_PRICE_LABELS: Record<PlanId, string> = {
  starter: "$49",
  team: "$149",
  enterprise: "Custom",
};

/** Same list as `PlanStatus` in the Prisma schema; the `satisfies` makes a drift a compile error. */
export const PLAN_STATUSES = ["trial", "active", "past_due", "cancelled", "internal"] as const satisfies readonly DbPlanStatus[];
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  trial: "Trial",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
  internal: "Internal",
};

/** The editable plan record of one organization. Dates are ISO strings (`trialEndsAt` is a calendar date). */
export interface PlanRecord {
  plan: string | null;
  planStatus: PlanStatus;
  trialEndsAt: string | null;
  billingReference: string | null;
}

export const BILLING_REFERENCE_MAX_LENGTH = 200;

// ---- Audit log (N4.2) ------------------------------------------------------

export const ADMIN_AUDIT_ACTIONS = [
  "view_tenant",
  "update_plan",
  "pause_polling",
  "resume_polling",
  "request_renormalize",
  "update_worker_settings",
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export const ADMIN_AUDIT_ACTION_LABELS: Record<AdminAuditAction, string> = {
  view_tenant: "Viewed tenant",
  update_plan: "Edited plan record",
  pause_polling: "Paused polling",
  resume_polling: "Resumed polling",
  request_renormalize: "Requested re-normalization",
  update_worker_settings: "Changed worker settings",
};

export interface AdminAuditRow {
  id: string;
  actorEmail: string;
  action: string;
  organizationId: string | null;
  /** Looked up for display; null if the organization no longer exists (the audit row outlives it). */
  organizationName: string | null;
  integrationId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AdminAuditData {
  rows: AdminAuditRow[];
  /** Pass back as `before` to load the next, older page; null on the last page. */
  nextCursor: string | null;
}

/** Narrows the audit log. Every field is optional; none of them can change or hide a row's contents. */
export interface AdminAuditFilters {
  /** Only rows of this action. */
  action?: AdminAuditAction | null;
  /** Leave out the quiet `view_tenant` rows so real changes stand out. */
  hideViews?: boolean;
  /** Case-insensitive match on the operator's email. */
  actor?: string | null;
  /** Only rows about this organization. */
  organizationId?: string | null;
}

// ---- Operator integration controls (N4.5) ----------------------------------

export const INTEGRATION_CONTROLS = ["pause_polling", "resume_polling", "request_renormalize"] as const;
export type IntegrationControl = (typeof INTEGRATION_CONTROLS)[number];

// ---- Tenants list and detail (N4.4) ----------------------------------------

export type AdminIntegrationStatus = "connected" | "disconnected" | "reauth_required" | "permission_denied";

/**
 * `unhealthy`: a customer's data is not being kept current (reauth or lost
 * access, a failing streak, or stale with polling not paused on purpose).
 * `attention`: working, but an operator should look (polling paused, alert
 * delivery failing). `none`: no connected integration to be healthy.
 */
export type TenantHealth = "healthy" | "attention" | "unhealthy" | "none";

/** Most urgent first; the default order of the Tenants list. */
export const TENANT_HEALTH_RANK: Record<TenantHealth, number> = { unhealthy: 0, attention: 1, healthy: 2, none: 3 };

export const TENANT_SORTS = ["severity", "name", "cases", "coverage"] as const;
export type TenantSort = (typeof TENANT_SORTS)[number];

export const TENANT_SORT_LABELS: Record<TenantSort, string> = {
  severity: "Health (worst first)",
  name: "Name (A to Z)",
  cases: "Open cases (most first)",
  coverage: "Link coverage (lowest first)",
};

/** Link coverage under this share of recent cases is flagged: most of that tenant's cases cannot be traced to engineering work. */
export const LINK_COVERAGE_FLAG_RATIO = 0.6;

export interface AdminTenantIntegrationRow {
  id: string;
  provider: IntegrationProvider;
  role: SourceRole;
  status: AdminIntegrationStatus;
  lastSuccessfulSyncAt: string | null;
  failingSince: string | null;
  lastSyncError: string | null;
  pollingPausedAt: string | null;
  stale: boolean;
  staleSince: string | null;
}

export interface AdminTenantRow {
  organizationId: string;
  name: string;
  createdAt: string;
  ownerEmail: string | null;
  memberCount: number;
  pendingInvitations: number;
  plan: string | null;
  planStatus: PlanStatus;
  trialEndsAt: string | null;
  billingReference: string | null;
  integrations: AdminTenantIntegrationRow[];
  openCases: number;
  evaluations24h: number;
  notificationsSent24h: number;
  notificationsFailed24h: number;
  linkCoverage: LinkCoverage;
  health: TenantHealth;
}

export interface AdminProviderPairCount {
  /** Connected providers, ticket source first, e.g. "Zendesk + Jira"; "No integrations" for none. */
  pair: string;
  tenants: number;
}

export interface AdminTenantsData {
  asOf: string;
  tenants: AdminTenantRow[];
  /** Counts only, never names (N4.7): how many tenants use each combination of providers. */
  providerPairCounts: AdminProviderPairCount[];
  /** How many tenants carry each plan status, and how many have no plan recorded yet. */
  planStatusCounts: Record<PlanStatus, number>;
  planNotRecorded: number;
}

export interface AdminIntegrationDetailRow {
  id: string;
  provider: IntegrationProvider;
  role: SourceRole;
  status: AdminIntegrationStatus;
  connectedAt: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastSuccessfulSyncAt: string | null;
  consecutiveFailures: number;
  failingSince: string | null;
  lastSyncDurationMs: number | null;
  stale: boolean;
  staleSince: string | null;
  pollingPausedAt: string | null;
  renormalizeRequestedAt: string | null;
  /** From the integration cursor; null until the first backfill has finished. */
  backfillCompletedAt: string | null;
}

export interface AdminAlertFailureRow {
  commitmentId: string;
  /** The ticket's id in its source system. Never the subject: the operator needs to find the case, not read it. */
  externalId: string;
  kind: string;
  threshold: number;
  error: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
}

export interface AdminSlaImportSummary {
  provider: IntegrationProvider | null;
  unsupportedConditions: number;
  unsupportedMetrics: number;
  policiesWithNoUsableTargets: number;
  policiesWithUnresolvedSchedule: number;
  policiesArchived: number;
  casesWithNoMatchingPolicy: number;
  updatedAt: string;
}

/** This organization's own worker run, from `OrganizationWorkState` (there is no global tick since per-organization scheduling). */
export interface AdminWorkRunSummary {
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  /** `lastFinishedAt - lastStartedAt` of the most recent completed run; null while one is unfinished or none has run. */
  lastRunDurationMs: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  activeNextDueAt: string;
}

export interface AdminTenantDetail {
  asOf: string;
  tenant: AdminTenantRow;
  integrations: AdminIntegrationDetailRow[];
  failingAlertCount: number;
  recentAlertFailures: AdminAlertFailureRow[];
  slaImport: AdminSlaImportSummary | null;
  /** Open cases with no commitment, i.e. no matching SLA policy (the dashboard's blind-spot count, same query). */
  casesWithNoMatchingPolicy: number;
  work: AdminWorkRunSummary | null;
}
