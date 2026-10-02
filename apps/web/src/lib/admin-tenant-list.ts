import {
  TENANT_HEALTH_RANK,
  type AdminTenantRow,
  type PlanStatus,
  type TenantHealth,
  type TenantSort,
} from "./types/admin";

/** "Not recorded" is a plan filter of its own: a tenant with no plan set yet. */
export type TenantPlanFilter = PlanStatus | "unrecorded" | "all";
export type TenantHealthFilter = TenantHealth | "all";

export interface TenantListControls {
  query: string;
  health: TenantHealthFilter;
  plan: TenantPlanFilter;
  sort: TenantSort;
}

export const DEFAULT_TENANT_CONTROLS: TenantListControls = { query: "", health: "all", plan: "all", sort: "severity" };

export function matchesTenantQuery(tenant: Pick<AdminTenantRow, "name" | "ownerEmail" | "organizationId">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return (
    tenant.name.toLowerCase().includes(needle) ||
    (tenant.ownerEmail ?? "").toLowerCase().includes(needle) ||
    tenant.organizationId.toLowerCase().includes(needle)
  );
}

function matchesPlan(tenant: Pick<AdminTenantRow, "plan" | "planStatus">, plan: TenantPlanFilter): boolean {
  if (plan === "all") return true;
  if (plan === "unrecorded") return tenant.plan === null;
  return tenant.planStatus === plan;
}

/** Link coverage as a sortable number: lowest first, and a tenant with nothing to measure last. */
function coverageKey(tenant: Pick<AdminTenantRow, "linkCoverage">): number {
  return tenant.linkCoverage.ratio ?? Number.POSITIVE_INFINITY;
}

const SORTERS: Record<TenantSort, (a: AdminTenantRow, b: AdminTenantRow) => number> = {
  severity: (a, b) => TENANT_HEALTH_RANK[a.health] - TENANT_HEALTH_RANK[b.health],
  name: () => 0,
  cases: (a, b) => b.openCases - a.openCases,
  coverage: (a, b) => coverageKey(a) - coverageKey(b),
};

/** The tenants an operator sees for a set of controls. Never mutates its input; ties always fall back to name. */
export function selectTenants(tenants: AdminTenantRow[], controls: TenantListControls): AdminTenantRow[] {
  return tenants
    .filter(
      (tenant) =>
        (controls.health === "all" || tenant.health === controls.health) &&
        matchesPlan(tenant, controls.plan) &&
        matchesTenantQuery(tenant, controls.query),
    )
    .sort((a, b) => SORTERS[controls.sort](a, b) || a.name.localeCompare(b.name));
}

/** How many tenants carry each health word, over the whole list (so the filter chips stay stable while filtering). */
export function countByHealth(tenants: Pick<AdminTenantRow, "health">[]): Record<TenantHealth | "all", number> {
  const counts = { all: tenants.length, unhealthy: 0, attention: 0, healthy: 0, none: 0 };
  for (const tenant of tenants) counts[tenant.health] += 1;
  return counts;
}
