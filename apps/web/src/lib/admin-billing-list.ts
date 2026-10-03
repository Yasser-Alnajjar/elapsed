import type {
  AdminBillingTenantRow,
  BillingHealth,
  BillingPlanTier,
  BillingSort,
  DunningQueueItem,
} from "@/lib/types/admin-billing";

/**
 * The tenant billing directory's controls (search, filters, sort, paging) and
 * headline figures as pure functions over the rows the server sent. The view
 * only holds state; everything here is unit-tested.
 */

export type BillingStatusFilter = "all" | "active" | "trialing" | "past_due";

export interface BillingListControls {
  query: string;
  plan: "all" | BillingPlanTier;
  status: BillingStatusFilter;
  health: "all" | BillingHealth;
  sort: BillingSort;
}

export const DEFAULT_BILLING_CONTROLS: BillingListControls = {
  query: "",
  plan: "all",
  status: "all",
  health: "all",
  sort: "next_billing",
};

function matchesQuery(row: AdminBillingTenantRow, query: string): boolean {
  if (query === "") return true;
  return [row.name, row.id, row.ownerEmail ?? "", row.rateNote.text].some((value) => value.toLowerCase().includes(query));
}

/** Higher is worse: overdue by how long, then something ending soon, then trials by how close they are to ending. */
function delinquencySeverity(row: AdminBillingTenantRow): number {
  if (row.overdueDays !== null) return 1000 + row.overdueDays;
  if (row.health === "expiring") return 500;
  if (row.status === "trialing") return 100 - Math.min(99, row.trialDaysLeft ?? 99);
  return 0;
}

const SORTS: Record<BillingSort, (a: AdminBillingTenantRow, b: AdminBillingTenantRow) => number> = {
  // Overdue first (their date is in the past), then soonest; no renewal last.
  next_billing: (a, b) =>
    (a.nextBillingAt ? Date.parse(a.nextBillingAt) : Infinity) - (b.nextBillingAt ? Date.parse(b.nextBillingAt) : Infinity),
  mrr_desc: (a, b) => b.mrrCents - a.mrrCents,
  seats_desc: (a, b) => b.seats.used - a.seats.used,
  delinquency: (a, b) => delinquencySeverity(b) - delinquencySeverity(a),
  created_desc: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
};

export function selectBillingTenants(rows: AdminBillingTenantRow[], controls: BillingListControls): AdminBillingTenantRow[] {
  const query = controls.query.trim().toLowerCase();
  return rows
    .filter(
      (row) =>
        matchesQuery(row, query) &&
        (controls.plan === "all" || row.tier === controls.plan) &&
        (controls.status === "all" || row.status === controls.status) &&
        (controls.health === "all" || row.health === controls.health),
    )
    .sort((a, b) => SORTS[controls.sort](a, b) || a.name.localeCompare(b.name));
}

export function countByTier(rows: AdminBillingTenantRow[]): Record<"all" | BillingPlanTier, number> {
  const counts = { all: rows.length, enterprise: 0, team: 0, starter: 0, none: 0 };
  for (const row of rows) counts[row.tier] += 1;
  return counts;
}

export function countByStatus(rows: AdminBillingTenantRow[]): Record<BillingStatusFilter, number> {
  const counts = { all: rows.length, active: 0, trialing: 0, past_due: 0 };
  for (const row of rows) {
    if (row.status === "active" || row.status === "trialing" || row.status === "past_due") counts[row.status] += 1;
  }
  return counts;
}

export function countByHealth(rows: AdminBillingTenantRow[]): Record<BillingHealth, number> {
  const counts = { healthy: 0, expiring: 0, overdue: 0 };
  for (const row of rows) counts[row.health] += 1;
  return counts;
}

export interface BillingKpis {
  mrrCents: number;
  arrCents: number;
  total: number;
  active: number;
  trialing: number;
  pastDue: number;
  /** Cancelled, internal, or never subscribed. */
  other: number;
  /** Open invoices that are already overdue. */
  atRiskCents: number;
  attention: number;
  /** Days the most overdue invoice is late, across tenants. */
  maxOverdueDays: number | null;
  seatsUsed: number;
  /** Licensed seats across live subscriptions. */
  seatsLicensed: number;
}

export function billingKpis(rows: AdminBillingTenantRow[]): BillingKpis {
  const count = (status: AdminBillingTenantRow["status"]) => rows.filter((row) => row.status === status).length;
  const mrrCents = rows.reduce((sum, row) => sum + row.mrrCents, 0);
  const active = count("active");
  const trialing = count("trialing");
  const pastDue = count("past_due");
  const overdue = rows.filter((row) => row.overdueDays !== null);
  const licensed = rows.filter((row) => row.seats.licensed !== null);
  return {
    mrrCents,
    arrCents: mrrCents * 12,
    total: rows.length,
    active,
    trialing,
    pastDue,
    other: rows.length - active - trialing - pastDue,
    atRiskCents: overdue.reduce((sum, row) => sum + row.openCents, 0),
    attention: rows.filter((row) => row.health !== "healthy").length,
    maxOverdueDays: overdue.length ? Math.max(...overdue.map((row) => row.overdueDays ?? 0)) : null,
    seatsUsed: licensed.reduce((sum, row) => sum + row.seats.used, 0),
    seatsLicensed: licensed.reduce((sum, row) => sum + (row.seats.licensed ?? 0), 0),
  };
}

/** Tenants with an overdue invoice, the longest overdue first. */
export function dunningQueue(rows: AdminBillingTenantRow[]): DunningQueueItem[] {
  return rows
    .filter((row) => row.overdueDays !== null)
    .map((row) => ({ tenantId: row.id, tenantName: row.name, amountCents: row.openCents, overdueDays: row.overdueDays ?? 0 }))
    .sort((a, b) => b.overdueDays - a.overdueDays || b.amountCents - a.amountCents);
}
