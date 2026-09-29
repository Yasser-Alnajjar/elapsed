/**
 * The static fixture config as one tenant sees it. Every external id (Zendesk org / user / policy /
 * schedule / ticket ids, Jira status / project / issue ids and keys, account ids, hostnames) is the
 * shared fixture value shifted by the tenant's index, so no two tenants can ever collide on an
 * external id and a leaked row is recognisable by its id alone.
 */
import {
  AGENTS,
  CUSTOMERS,
  CUSTOM_FIELD_IMPACT,
  CUSTOM_FIELD_PRODUCT_AREA,
  JIRA_ENGINEERS,
  JIRA_PROJECTS,
  JIRA_REPORTERS,
  JIRA_STATUSES,
  SCHEDULES,
  UNASSIGNED_REQUESTERS,
  ZENDESK_BRANDS,
  ZENDESK_GROUPS,
  tenantRequesterName,
  type AgentDef,
  type CustomerDef,
  type JiraPersonDef,
  type JiraProjectKey,
  type JiraStatusKey,
  type ScheduleDef,
  type TenantDef,
} from "./config";

export interface TenantConfig {
  tenant: TenantDef;
  customers: CustomerDef[];
  unassignedRequesters: string[];
  schedules: ScheduleDef[];
  agents: AgentDef[];
  reporters: JiraPersonDef[];
  engineers: JiraPersonDef[];
  statuses: Record<JiraStatusKey, { id: string; name: string; category: "new" | "indeterminate" | "done" }>;
  projects: Record<JiraProjectKey, { id: string; name: string }>;
  groups: number[];
  brands: number[];
  formId: number;
  customFieldProductArea: number;
  customFieldImpact: number;
  recipient: string;
  ids: {
    firstTicketId: number;
    requesterBase: number;
    unassignedBase: number;
    policyBase: number;
    firstJiraNumber: number;
    firstHistoryId: number;
    firstOfficialLinkId: number;
    firstRemoteLinkId: number;
  };
}

export function tenantConfig(tenant: TenantDef): TenantConfig {
  const t = tenant.index;
  const suffix = `-${tenant.key}`;
  return {
    tenant,
    customers: CUSTOMERS.map((c) => ({
      ...c,
      zendeskOrgId: c.zendeskOrgId + t * 1_000,
      requesters: c.requesters.map((name) => tenantRequesterName(t, name)),
    })),
    unassignedRequesters: UNASSIGNED_REQUESTERS.map((name) => tenantRequesterName(t, name)),
    schedules: SCHEDULES.map((s) => ({
      ...s,
      scheduleId: s.scheduleId + t * 100,
      holidays: s.holidays.map((h) => ({ ...h, id: h.id + t * 100 })),
    })),
    agents: AGENTS.map((a) => ({ ...a, id: a.id + t * 100 })),
    reporters: JIRA_REPORTERS.map((p) => ({ ...p, accountId: p.accountId + suffix })),
    engineers: JIRA_ENGINEERS.map((p) => ({ ...p, accountId: p.accountId + suffix })),
    statuses: Object.fromEntries(
      Object.entries(JIRA_STATUSES).map(([key, s]) => [key, { ...s, id: String(Number(s.id) + t * 10) }]),
    ) as TenantConfig["statuses"],
    projects: Object.fromEntries(
      Object.entries(JIRA_PROJECTS).map(([key, p]) => [key, { ...p, id: String(Number(p.id) + t * 10) }]),
    ) as TenantConfig["projects"],
    groups: ZENDESK_GROUPS.map((g) => g + t * 10),
    brands: ZENDESK_BRANDS.map((b) => b + t * 10),
    formId: 910_001 + t * 10,
    customFieldProductArea: CUSTOM_FIELD_PRODUCT_AREA + t * 1_000,
    customFieldImpact: CUSTOM_FIELD_IMPACT + t * 1_000,
    recipient: `support@${tenant.key}.elapsed-seed.test`,
    ids: {
      firstTicketId: 41_001 + t * 100_000,
      requesterBase: 6_100_000_000 + t * 1_000_000,
      unassignedBase: 6_200_000_000 + t * 1_000_000,
      policyBase: 3_300_000_001 + t * 100,
      firstJiraNumber: 100 + t * 1_000,
      firstHistoryId: 50_000 + t * 1_000,
      firstOfficialLinkId: 900_000 + t * 10_000,
      firstRemoteLinkId: 30_000 + t * 1_000,
    },
  };
}
