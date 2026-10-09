import type { SourceRole } from "@sla/core";
import type { PlanStatus as DbPlanStatus } from "@sla/db";
import { formatPlanPrice, PLAN_IDS, PLAN_LIST, type LimitedResource, type PlanId } from "@sla/db/plans";
import type { IntegrationProvider } from "./integrations";
import type { LinkCoverage } from "./link-coverage";

/**
 * Platform-admin types (N4). Everything here is operator-facing: nothing in
 * this file is ever rendered to a tenant user. Only types and constants; the
 * read models live in `lib/admin-*`.
 */

// ---- Plan record (N4.3) ----------------------------------------------------

/**
 * The plans are defined once, in `@sla/db/plans` (N6.1, decision D14), and the
 * pricing page and entitlement checks read the same constant. `Organization.plan`
 * stays a string column; the admin API only accepts these identifiers.
 */
export { PLAN_IDS };
export type { PlanId };

export const PLAN_LABELS = Object.fromEntries(PLAN_LIST.map((plan) => [plan.id, plan.name])) as Record<PlanId, string>;

/** The list price the pricing page shows; a label for the operator, never a billing source. */
export const PLAN_PRICE_LABELS = Object.fromEntries(PLAN_LIST.map((plan) => [plan.id, formatPlanPrice(plan).price])) as Record<PlanId, string>;

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
  "billing_override",
  "enable_custom_provider",
  "disable_custom_provider",
  "apply_guard_override",
  "update_integration_availability",
  "add_integration_allowlist",
  "remove_integration_allowlist",
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export const ADMIN_AUDIT_ACTION_LABELS: Record<AdminAuditAction, string> = {
  view_tenant: "Viewed tenant",
  update_plan: "Edited plan record",
  pause_polling: "Paused polling",
  resume_polling: "Resumed polling",
  request_renormalize: "Requested re-normalization",
  update_worker_settings: "Changed worker settings",
  billing_override: "Billing override",
  enable_custom_provider: "Enabled Custom REST (Beta)",
  disable_custom_provider: "Disabled Custom REST (Beta)",
  apply_guard_override: "Applied a guard override (support-assisted)",
  update_integration_availability: "Changed integration availability",
  add_integration_allowlist: "Added to a Beta allowlist",
  remove_integration_allowlist: "Removed from a Beta allowlist",
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
  entitlements: AdminEntitlements;
  /**
   * This organization's place on each Beta allowlist (D33, N10). Every provider
   * whose policy is Beta with an allowlist, plus any provider it is still
   * listed on. Replaces the N9 Custom REST flag.
   */
  betaAccess: AdminTenantBetaAccess[];
}

/** One entitlement check that warned, blocked, or found a lapsed trial (N6.3, N6.4). */
export interface AdminEntitlementEventRow {
  id: string;
  kind: "limit_warned" | "creation_blocked" | "trial_expired";
  /** A `LimitedResource` key, or null for `trial_expired`. */
  resource: LimitedResource | null;
  used: number | null;
  limit: number | null;
  /** `trial_expired` only: when the owner email was sent. */
  notifiedAt: string | null;
  createdAt: string;
}

/** What this tenant uses against its plan, and what the checks recorded (N6.2). Read-only for the operator. */
export interface AdminEntitlements {
  /** The operator switch (`WorkerSettings.entitlementsEnforced`). Off: usage is shown, nothing is checked. */
  enforced: boolean;
  usage: Record<LimitedResource, number>;
  /** The recorded plan's limits, `null` per resource for unlimited; the whole field is null when no known plan is recorded. */
  limits: Record<LimitedResource, number | null> | null;
  trialExpired: boolean;
  events: AdminEntitlementEventRow[];
}

/** One organization's usage facts (N5.7), all read from columns the app writes best-effort. */
export interface AdminUsageOrganizationRow {
  organizationId: string;
  name: string;
  /** The latest `User.lastSeenAt` among its members, or null when none has been seen since stamping began. */
  lastSeenAt: string | null;
  activeThisWeek: boolean;
  /** Alerts delivered in the last 30 days, and how many were opened from their link. */
  alertsSent30d: number;
  alertsOpened30d: number;
  /** `firstFindingsViewedAt - createdAt`, in minutes; null until the findings were first viewed. */
  minutesToFirstValue: number | null;
}

/** The validation metrics (roadmap: weekly active orgs, alert click-through, time to first value), readable without SQL. */
export interface AdminUsageData {
  asOf: string;
  activeWindowDays: number;
  alertWindowDays: number;
  organizationCount: number;
  weeklyActiveOrganizations: number;
  weeklyActiveUsers: number;
  alerts: { sent: number; opened: number; clickThroughRatio: number | null };
  timeToFirstValue: { organizations: number; medianMinutes: number | null };
  /** Least recently seen first, so the organizations to look into lead. */
  organizations: AdminUsageOrganizationRow[];
}

// ---- Integration Control Center (N10, D33) ------------------------------------

export const RELEASE_STAGES = ["stable", "beta", "coming_soon"] as const;
export type ReleaseStage = (typeof RELEASE_STAGES)[number];
export const BETA_ACCESS_MODES = ["all_organizations", "allowlist"] as const;
export type BetaAccessMode = (typeof BETA_ACCESS_MODES)[number];

export const RELEASE_STAGE_LABELS: Record<ReleaseStage, string> = {
  stable: "Stable",
  beta: "Beta",
  coming_soon: "Coming soon",
};
export const BETA_ACCESS_LABELS: Record<BetaAccessMode, string> = {
  all_organizations: "All organizations",
  allowlist: "Allowlist only",
};

/** Operator-authored text shown to customers; kept short. */
export const STATUS_MESSAGE_MAX_LENGTH = 280;
/** Every availability change needs a reason for the audit log. */
export const AVAILABILITY_REASON_MAX_LENGTH = 500;

/** The policy fields an operator edits; what the audit log records before and after. */
export interface AvailabilityPolicyFields {
  enabled: boolean;
  releaseStage: ReleaseStage;
  betaAccess: BetaAccessMode;
  statusMessage: string | null;
}

export interface AvailabilityAllowlistEntry {
  organizationId: string;
  organizationName: string | null;
  addedByEmail: string;
  createdAt: string;
}

/** One provider in `/admin/integrations`. Counts only: never a credential. */
export interface AdminIntegrationAvailabilityRow extends AvailabilityPolicyFields {
  provider: IntegrationProvider;
  name: string;
  category: "ticket_source" | "work_tracker" | "code_host";
  connectionType: "oauth" | "api_credentials";
  version: number;
  updatedAt: string | null;
  updatedByEmail: string | null;
  allowlist: AvailabilityAllowlistEntry[];
  /** Integration rows that are not disconnected. */
  connections: number;
  /** Distinct organizations with a connection. */
  activeOrganizations: number;
  /** Connections the current policy makes unavailable to their organization (paused by Elapsed). */
  pausedConnections: number;
  health: { healthy: number; failing: number; needsAttention: number; stale: number };
  rolloutBlock: { id: string; reason: string } | null;
}

export interface AdminIntegrationsData {
  rows: AdminIntegrationAvailabilityRow[];
  /** For the allowlist "add organization" picker. */
  organizations: { id: string; name: string }[];
}

/** What a proposed change would take away; read-only. */
export interface AvailabilityImpact {
  organizationsLosingAccess: { id: string; name: string; connections: number }[];
  connectionsAffected: number;
}

export interface AdminTenantBetaAccess {
  provider: IntegrationProvider;
  name: string;
  listed: boolean;
  /** The provider's policy currently restricts it to its allowlist (Beta, allowlist, enabled). */
  allowlistApplies: boolean;
  rolloutBlock: { id: string; reason: string } | null;
}
