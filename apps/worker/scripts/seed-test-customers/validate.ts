/**
 * Read-only validation of the seeded organizations: counts everything the seed creates, per
 * organization and in total, prints a per-customer table, and asserts the coverage and
 * tenant-isolation properties the dataset exists to provide.
 */
import { Prisma, type PrismaClient } from "@sla/db";
import { CUSTOMERS, TENANTS, type TenantDef } from "./config";

export interface CustomerRow {
  name: string;
  zendeskOrgId: string | null;
  tier: string | null;
  requesters: number;
  cases: number;
  openCases: number;
  closedCases: number;
  deletedCases: number;
  escalatedCases: number;
  jiraLinks: number;
  commitments: number;
  commitmentStatus: Record<string, number>;
  events: number;
  evaluations: number;
  hasCalendarOverride: boolean;
}

export interface Report {
  organizationId: string;
  customers: CustomerRow[];
  unassigned: CustomerRow;
  totals: {
    customers: number;
    zendeskMappings: number;
    requesters: number;
    cases: number;
    caseStatus: Record<string, number>;
    commitments: number;
    commitmentStatus: Record<string, number>;
    commitmentKind: Record<string, number>;
    openBreached: number;
    closedBreached: number;
    normalizedEvents: number;
    normalizedEventType: Record<string, number>;
    normalizedEventSystem: Record<string, number>;
    evaluations: number;
    evaluationStatus: Record<string, number>;
    commitmentsWithoutEvaluation: number;
    rawEvents: Record<string, number>;
    caseLinks: number;
    caseLinkMethod: Record<string, number>;
    caseLinksUnlinked: number;
    casesWithNoCommitments: number;
    casesWithMultipleJiraLinks: number;
    jiraIssuesLinked: number;
    slaPolicies: Record<string, number>;
    slaPolicyVersions: number;
    calendars: Record<string, number>;
    customersWithCalendarOverride: number;
    policyChanges: number;
    notifications: number;
    notificationFailures: number;
    users: number;
    pendingInvitations: number;
    integrations: Record<string, string>;
    slaImportSummary: { unsupportedMetrics: number; casesWithNoMatchingPolicy: number } | null;
    calendarVersions: number;
    /** Every tenant-scoped row the seed created for this organization. */
    totalRecords: number;
  };
  minEventsPerCase: number;
  crossTenantReferences: number;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

function bump(record: Record<string, number>, key: string, by = 1): void {
  record[key] = (record[key] ?? 0) + by;
}

function emptyRow(name: string): CustomerRow {
  return {
    name,
    zendeskOrgId: null,
    tier: null,
    requesters: 0,
    cases: 0,
    openCases: 0,
    closedCases: 0,
    deletedCases: 0,
    escalatedCases: 0,
    jiraLinks: 0,
    commitments: 0,
    commitmentStatus: {},
    events: 0,
    evaluations: 0,
    hasCalendarOverride: false,
  };
}

export async function collectReport(prisma: PrismaClient, organizationId: string): Promise<Report> {
  const [customers, cases, rawEvents, policies, policyVersionCount, calendars, calendarVersionCount, policyChanges, notifications, failures, users, invitations, integrations, summary] =
    await Promise.all([
      prisma.customer.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
      prisma.case.findMany({
        where: { organizationId },
        include: {
          caseLinks: true,
          normalizedEvents: { select: { type: true, system: true } },
          commitments: { select: { kind: true, status: true, closedAt: true, _count: { select: { evaluations: true } } } },
        },
      }),
      prisma.rawEvent.groupBy({ by: ["integrationId"], where: { integration: { organizationId } }, _count: true }),
      prisma.sLAPolicy.findMany({ where: { organizationId }, select: { source: true, archivedAt: true } }),
      prisma.sLAPolicyVersion.count({ where: { policy: { organizationId } } }),
      prisma.businessCalendar.findMany({ where: { organizationId }, select: { source: true } }),
      prisma.businessCalendarVersion.count({ where: { calendar: { organizationId } } }),
      prisma.commitmentPolicyChange.count({ where: { commitment: { case: { organizationId } } } }),
      prisma.notification.count({ where: { commitment: { case: { organizationId } } } }),
      prisma.notificationFailure.count({ where: { commitment: { case: { organizationId } } } }),
      prisma.user.count({ where: { organizationId } }),
      prisma.organizationInvitation.count({ where: { organizationId, status: "pending" } }),
      prisma.integration.findMany({ where: { organizationId }, select: { id: true, provider: true, status: true } }),
      prisma.slaImportSummary.findUnique({ where: { organizationId } }),
    ]);

  const integrationById = new Map(integrations.map((i) => [i.id, i.provider]));
  const rawByProvider: Record<string, number> = {};
  for (const row of rawEvents) bump(rawByProvider, integrationById.get(row.integrationId) ?? "unknown", row._count);

  const rows = new Map<string | null, CustomerRow>();
  for (const c of customers) {
    const row = emptyRow(c.name);
    row.zendeskOrgId = c.zendeskOrgId;
    row.tier = c.tier;
    row.hasCalendarOverride = c.calendarId !== null;
    rows.set(c.id, row);
  }
  const unassigned = emptyRow("(no customer)");
  rows.set(null, unassigned);

  const requestersByCustomer = new Map<string | null, Set<string>>();
  const totals: Report["totals"] = {
    customers: customers.length,
    zendeskMappings: customers.filter((c) => c.zendeskOrgId !== null).length,
    requesters: 0,
    cases: cases.length,
    caseStatus: {},
    commitments: 0,
    commitmentStatus: {},
    commitmentKind: {},
    openBreached: 0,
    closedBreached: 0,
    normalizedEvents: 0,
    normalizedEventType: {},
    normalizedEventSystem: {},
    evaluations: 0,
    evaluationStatus: {},
    commitmentsWithoutEvaluation: 0,
    rawEvents: rawByProvider,
    caseLinks: 0,
    caseLinkMethod: {},
    caseLinksUnlinked: 0,
    casesWithNoCommitments: 0,
    casesWithMultipleJiraLinks: 0,
    jiraIssuesLinked: 0,
    slaPolicies: {},
    slaPolicyVersions: policyVersionCount,
    calendars: {},
    customersWithCalendarOverride: customers.filter((c) => c.calendarId !== null).length,
    policyChanges,
    notifications,
    notificationFailures: failures,
    users,
    pendingInvitations: invitations,
    integrations: Object.fromEntries(integrations.map((i) => [i.provider, i.status])),
    slaImportSummary: summary
      ? { unsupportedMetrics: summary.unsupportedMetrics, casesWithNoMatchingPolicy: summary.casesWithNoMatchingPolicy }
      : null,
    calendarVersions: calendarVersionCount,
    totalRecords: 0,
  };

  let minEventsPerCase = Number.POSITIVE_INFINITY;
  const linkedIssues = new Set<string>();
  const allRequesters = new Set<string>();

  for (const c of cases) {
    const row = rows.get(c.customerId) ?? unassigned;
    row.cases += 1;
    const status = c.deletedAt ? "deleted" : c.closedAt ? "closed" : "open";
    bump(totals.caseStatus, status);
    if (c.deletedAt) row.deletedCases += 1;
    else if (c.closedAt) row.closedCases += 1;
    else row.openCases += 1;

    if (c.requesterName) {
      const set = requestersByCustomer.get(c.customerId) ?? new Set<string>();
      set.add(c.requesterName);
      requestersByCustomer.set(c.customerId, set);
      allRequesters.add(c.requesterName);
    }

    const jiraLinks = c.caseLinks.filter((l) => l.system === "jira");
    if (jiraLinks.length > 0) row.escalatedCases += 1;
    if (jiraLinks.length > 1) totals.casesWithMultipleJiraLinks += 1;
    row.jiraLinks += jiraLinks.length;
    for (const link of jiraLinks) {
      totals.caseLinks += 1;
      bump(totals.caseLinkMethod, `${link.method}/${link.confidence}${link.unlinkedAt ? " (unlinked)" : ""}`);
      if (link.unlinkedAt) totals.caseLinksUnlinked += 1;
      linkedIssues.add(link.externalId);
    }

    row.events += c.normalizedEvents.length;
    totals.normalizedEvents += c.normalizedEvents.length;
    minEventsPerCase = Math.min(minEventsPerCase, c.normalizedEvents.length);
    for (const e of c.normalizedEvents) {
      bump(totals.normalizedEventType, e.type);
      bump(totals.normalizedEventSystem, e.system);
    }

    if (c.commitments.length === 0 && !c.deletedAt) totals.casesWithNoCommitments += 1;
    for (const commitment of c.commitments) {
      row.commitments += 1;
      totals.commitments += 1;
      bump(row.commitmentStatus, commitment.status);
      bump(totals.commitmentStatus, commitment.status);
      bump(totals.commitmentKind, commitment.kind);
      if (commitment.status === "breached") {
        if (commitment.closedAt) totals.closedBreached += 1;
        else totals.openBreached += 1;
      }
      row.evaluations += commitment._count.evaluations;
      totals.evaluations += commitment._count.evaluations;
      if (commitment._count.evaluations === 0) totals.commitmentsWithoutEvaluation += 1;
    }
  }
  for (const [customerId, set] of requestersByCustomer) (rows.get(customerId) ?? unassigned).requesters = set.size;
  totals.requesters = allRequesters.size;
  totals.jiraIssuesLinked = linkedIssues.size;

  const evaluationStatuses = await prisma.evaluation.groupBy({
    by: ["status"],
    where: { commitment: { case: { organizationId } } },
    _count: true,
  });
  for (const row of evaluationStatuses) bump(totals.evaluationStatus, row.status, row._count);

  for (const p of policies) bump(totals.slaPolicies, `${p.source}${p.archivedAt ? " (archived)" : ""}`);
  for (const c of calendars) bump(totals.calendars, c.source);

  const sumOf = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0);
  totals.totalRecords =
    1 + // the organization itself
    totals.users +
    totals.pendingInvitations +
    Object.keys(totals.integrations).length +
    sumOf(totals.rawEvents) +
    totals.customers +
    totals.cases +
    totals.normalizedEvents +
    totals.caseLinks +
    totals.commitments +
    totals.evaluations +
    totals.notifications +
    totals.notificationFailures +
    sumOf(totals.slaPolicies) +
    totals.slaPolicyVersions +
    sumOf(totals.calendars) +
    totals.calendarVersions +
    totals.policyChanges +
    (totals.slaImportSummary ? 1 : 0);

  // Anything in this organization that points at another organization's row.
  const cross = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT (
      (SELECT count(*) FROM cases ca JOIN customers cu ON cu.id = ca."customerId"
        WHERE ca."organizationId" = ${organizationId} AND cu."organizationId" <> ca."organizationId")
      + (SELECT count(*) FROM commitments cm JOIN cases ca ON ca.id = cm."caseId"
          JOIN sla_policy_versions pv ON pv.id = cm."policyVersionId" JOIN sla_policies p ON p.id = pv."policyId"
          WHERE ca."organizationId" = ${organizationId} AND p."organizationId" <> ca."organizationId")
      + (SELECT count(*) FROM commitments cm JOIN cases ca ON ca.id = cm."caseId"
          JOIN business_calendar_versions bv ON bv.id = cm."calendarVersionId" JOIN business_calendars b ON b.id = bv."calendarId"
          WHERE ca."organizationId" = ${organizationId} AND b."organizationId" <> ca."organizationId")
      + (SELECT count(*) FROM customers cu JOIN business_calendars b ON b.id = cu."calendarId"
          WHERE cu."organizationId" = ${organizationId} AND b."organizationId" <> cu."organizationId")
      + (SELECT count(*) FROM customers cu JOIN business_calendar_versions bv ON bv.id = cu."calendarVersionId" JOIN business_calendars b ON b.id = bv."calendarId"
          WHERE cu."organizationId" = ${organizationId} AND b."organizationId" <> cu."organizationId")
      + (SELECT count(*) FROM organizations o JOIN business_calendars b ON b.id = o."defaultCalendarId"
          WHERE o.id = ${organizationId} AND b."organizationId" <> o.id)
      + (SELECT count(*) FROM sla_policy_versions pv JOIN sla_policies p ON p.id = pv."policyId"
          JOIN business_calendar_versions bv ON bv.id = pv."calendarVersionId" JOIN business_calendars b ON b.id = bv."calendarId"
          WHERE p."organizationId" = ${organizationId} AND b."organizationId" <> p."organizationId")
      + (SELECT count(*) FROM normalized_events ne JOIN cases ca ON ca.id = ne."caseId"
          JOIN raw_events re ON re.id = ne."sourceRawEventId" JOIN integrations i ON i.id = re."integrationId"
          WHERE ca."organizationId" = ${organizationId} AND i."organizationId" <> ca."organizationId")
    )::bigint AS n`;

  return {
    organizationId,
    customers: customers.map((c) => rows.get(c.id)!),
    unassigned,
    totals,
    minEventsPerCase: Number.isFinite(minEventsPerCase) ? minEventsPerCase : 0,
    crossTenantReferences: Number(cross[0]?.n ?? 0),
  };
}

export function checkReport(report: Report): Check[] {
  const t = report.totals;
  const check = (name: string, ok: boolean, detail: string): Check => ({ name, ok, detail });
  const count = (record: Record<string, number>, key: string) => record[key] ?? 0;
  return [
    check("exactly 11 customers", t.customers === 11, `${t.customers}`),
    check(
      "the customers are the 11 fixture customers (Customers, not Organizations)",
      JSON.stringify(report.customers.map((c) => c.name).sort()) === JSON.stringify(CUSTOMERS.map((c) => c.name).sort()),
      report.customers.map((c) => c.name).join(", "),
    ),
    check("every customer has a Zendesk org mapping", t.zendeskMappings === t.customers, `${t.zendeskMappings}/${t.customers}`),
    check("every customer has >= 2 requesters", report.customers.every((c) => c.requesters >= 2), report.customers.map((c) => c.requesters).join(",")),
    check("every customer has >= 3 cases", report.customers.every((c) => c.cases >= 3), report.customers.map((c) => c.cases).join(",")),
    check("customers differ in size (case counts not all equal)", new Set(report.customers.map((c) => c.cases)).size >= 6, `${new Set(report.customers.map((c) => c.cases)).size} distinct sizes`),
    check("open and closed cases both present", count(t.caseStatus, "open") >= 20 && count(t.caseStatus, "closed") >= 20, JSON.stringify(t.caseStatus)),
    check("a soft-deleted case exists", count(t.caseStatus, "deleted") >= 1, `${count(t.caseStatus, "deleted")}`),
    check("cases with no customer exist", report.unassigned.cases >= 1, `${report.unassigned.cases}`),
    check("cases with no matching policy (no commitments) exist", t.casesWithNoCommitments >= 1, `${t.casesWithNoCommitments}`),
    check("every case has >= 3 normalized events", report.minEventsPerCase >= 3, `min ${report.minEventsPerCase}`),
    check("commitment statuses on_track/at_risk/met/breached all present", ["on_track", "at_risk", "met", "breached"].every((s) => count(t.commitmentStatus, s) >= 1), JSON.stringify(t.commitmentStatus)),
    check("both open and closed breaches exist", t.openBreached >= 1 && t.closedBreached >= 1, `open ${t.openBreached}, closed ${t.closedBreached}`),
    check("all three commitment kinds present", ["first_response", "resolution", "next_reply"].every((k) => count(t.commitmentKind, k) >= 1), JSON.stringify(t.commitmentKind)),
    check("every commitment has >= 1 evaluation", t.commitmentsWithoutEvaluation === 0, `${t.commitmentsWithoutEvaluation} without`),
    check("evaluation history has transitions (more evaluations than commitments)", t.evaluations > t.commitments, `${t.evaluations} vs ${t.commitments}`),
    check("Zendesk -> Jira escalations exist", t.caseLinks >= 15, `${t.caseLinks} links to ${t.jiraIssuesLinked} issues`),
    check("official and remote links both present", Object.keys(t.caseLinkMethod).some((k) => k.startsWith("official_link")) && Object.keys(t.caseLinkMethod).some((k) => k.startsWith("remote_link")), JSON.stringify(t.caseLinkMethod)),
    check("an unlinked escalation exists", t.caseLinksUnlinked >= 1, `${t.caseLinksUnlinked}`),
    check("a case linked to multiple Jira issues exists", t.casesWithMultipleJiraLinks >= 1, `${t.casesWithMultipleJiraLinks}`),
    check("cases without escalation exist", report.customers.some((c) => c.cases > c.escalatedCases), "n/a"),
    check(
      "normalized event types covered",
      ["case_created", "agent_replied", "customer_replied", "state_changed", "case_closed", "issue_linked", "issue_unlinked", "priority_changed"].every((k) => count(t.normalizedEventType, k) >= 1),
      JSON.stringify(t.normalizedEventType),
    ),
    check("both zendesk and jira events present", count(t.normalizedEventSystem, "zendesk") >= 1 && count(t.normalizedEventSystem, "jira") >= 1, JSON.stringify(t.normalizedEventSystem)),
    check("imported and native SLA policies present", count(t.slaPolicies, "imported") >= 5 && count(t.slaPolicies, "native") >= 1, JSON.stringify(t.slaPolicies)),
    check("imported and native calendars present", count(t.calendars, "imported") >= 3 && count(t.calendars, "native") >= 1, JSON.stringify(t.calendars)),
    check("customer calendar overrides exist", t.customersWithCalendarOverride === 2, `${t.customersWithCalendarOverride}`),
    check("a commitment policy change was recorded (priority re-resolution)", t.policyChanges >= 1, `${t.policyChanges}`),
    check("alert history recorded (notifications and failures)", t.notifications >= 1 && t.notificationFailures >= 1, `${t.notifications} sent, ${t.notificationFailures} failed`),
    check("SLA import summary recorded", t.slaImportSummary !== null && t.slaImportSummary.unsupportedMetrics >= 1 && t.slaImportSummary.casesWithNoMatchingPolicy >= 1, JSON.stringify(t.slaImportSummary)),
    check("org users and a pending invitation exist", t.users === 2 && t.pendingInvitations === 1, `${t.users} users, ${t.pendingInvitations} pending`),
    check("zendesk and jira integrations connected", t.integrations.zendesk === "connected" && t.integrations.jira === "connected", JSON.stringify(t.integrations)),
    check("no cross-tenant references", report.crossTenantReferences === 0, `${report.crossTenantReferences}`),
  ];
}

const sum = (record: Record<string, number>) => Object.entries(record).map(([k, v]) => `${k} ${v}`).join(", ") || "-";

export function formatReport(report: Report, checks: Check[]): string {
  const t = report.totals;
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);
  const rows = [...report.customers, report.unassigned];

  push(`Seed organization: ${report.organizationId}`);
  push();
  push("== Totals ==");
  push(`Customers:               ${t.customers}   (Zendesk org mappings: ${t.zendeskMappings})`);
  push(`Requesters (distinct):   ${t.requesters}`);
  push(`Cases:                   ${t.cases}   (${sum(t.caseStatus)})`);
  push(`Commitments:             ${t.commitments}   (${sum(t.commitmentKind)})`);
  push(`  by status:             ${sum(t.commitmentStatus)}   [open breached ${t.openBreached}, closed breached ${t.closedBreached}]`);
  push(`Normalized events:       ${t.normalizedEvents}   (${sum(t.normalizedEventSystem)})`);
  push(`  by type:               ${sum(t.normalizedEventType)}`);
  push(`Evaluations:             ${t.evaluations}   (${sum(t.evaluationStatus)})`);
  push(`Raw events:              ${sum(t.rawEvents)}`);
  push(`Jira case links:         ${t.caseLinks}   (${sum(t.caseLinkMethod)}); ${t.jiraIssuesLinked} distinct issues; ${t.casesWithMultipleJiraLinks} case(s) with 2+ issues`);
  push(`SLA policies:            ${sum(t.slaPolicies)}   (${t.slaPolicyVersions} versions)`);
  push(`Business calendars:      ${sum(t.calendars)}   (${t.customersWithCalendarOverride} customer overrides)`);
  push(`Policy changes:          ${t.policyChanges}`);
  push(`Notifications:           ${t.notifications} sent, ${t.notificationFailures} failed`);
  push(`Users / invitations:     ${t.users} users, ${t.pendingInvitations} pending invitation`);
  push(`Integrations:            ${sum(Object.fromEntries(Object.entries(t.integrations).map(([k, v]) => [`${k}=${v}`, 1])))}`);
  push();
  push("== Per customer ==");
  const header = ["Customer", "Tier", "Req", "Cases", "Open", "Closed", "Escal", "Cmt", "on_track/at_risk/met/breached", "Events", "Evals"];
  const body = rows.map((r) => [
    r.name,
    r.tier ?? "-",
    String(r.requesters),
    String(r.cases),
    String(r.openCases),
    String(r.closedCases + r.deletedCases),
    String(r.escalatedCases),
    String(r.commitments),
    ["on_track", "at_risk", "met", "breached"].map((s) => r.commitmentStatus[s] ?? 0).join(" / "),
    String(r.events),
    String(r.evaluations),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 || i === 1 || i === 8 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  push(fmt(header));
  push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of body) push(fmt(row));
  push();
  push("== Checks ==");
  for (const c of checks) push(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
  const failed = checks.filter((c) => !c.ok).length;
  push();
  push(failed === 0 ? `All ${checks.length} checks passed.` : `${failed} of ${checks.length} checks FAILED.`);
  return lines.join("\n");
}


// --- All tenants ---------------------------------------------------------------------------------

export interface TenantReport {
  tenant: TenantDef;
  report: Report;
  organizationExists: boolean;
}

export interface AllReport {
  tenants: TenantReport[];
  /** Sums across the reported tenants. */
  totals: {
    organizations: number;
    customers: number;
    cases: number;
    commitments: number;
    evaluations: number;
    normalizedEvents: number;
    rawEvents: number;
    users: number;
    integrations: number;
    notifications: number;
    caseLinks: number;
    totalRecords: number;
  };
  /** How many seed organizations share a value that must be unique per tenant. */
  sharedAcrossTenants: {
    caseExternalIds: number;
    customerZendeskOrgIds: number;
    jiraIssueKeys: number;
    rawEventProviderIds: number;
    webhookSecrets: number;
    requesterNames: number;
    integrationSubdomains: number;
  };
  /** Rows, in any tenant, that reference a row in a different tenant. */
  crossTenantReferences: number;
  /** Seed organizations that exist but are not one of the expected tenants (e.g. the legacy single org). */
  strayOrganizations: string[];
}

export async function collectAll(prisma: PrismaClient, tenants: TenantDef[] = TENANTS): Promise<AllReport> {
  const orgIds = tenants.map((t) => t.orgId);
  const existing = new Set(
    (await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true } })).map((o) => o.id),
  );
  const reports: TenantReport[] = [];
  for (const tenant of tenants) {
    const organizationExists = existing.has(tenant.orgId);
    reports.push({ tenant, organizationExists, report: await collectReport(prisma, tenant.orgId) });
  }

  const totals: AllReport["totals"] = {
    organizations: reports.filter((r) => r.organizationExists).length,
    customers: 0,
    cases: 0,
    commitments: 0,
    evaluations: 0,
    normalizedEvents: 0,
    rawEvents: 0,
    users: 0,
    integrations: 0,
    notifications: 0,
    caseLinks: 0,
    totalRecords: 0,
  };
  for (const { report } of reports) {
    const t = report.totals;
    totals.customers += t.customers;
    totals.cases += t.cases;
    totals.commitments += t.commitments;
    totals.evaluations += t.evaluations;
    totals.normalizedEvents += t.normalizedEvents;
    totals.rawEvents += Object.values(t.rawEvents).reduce((a, b) => a + b, 0);
    totals.users += t.users;
    totals.integrations += Object.keys(t.integrations).length;
    totals.notifications += t.notifications;
    totals.caseLinks += t.caseLinks;
    totals.totalRecords += t.totalRecords;
  }

  const ids = Prisma.join(orgIds);
  const shared = async (query: Prisma.Sql): Promise<number> => Number((await prisma.$queryRaw<{ n: bigint }[]>(query))[0]?.n ?? 0);
  const sharedAcrossTenants: AllReport["sharedAcrossTenants"] = {
    caseExternalIds: await shared(Prisma.sql`
      SELECT count(*)::bigint AS n FROM (SELECT "externalId" FROM cases WHERE "organizationId" IN (${ids})
        GROUP BY "externalId" HAVING count(DISTINCT "organizationId") > 1) x`),
    customerZendeskOrgIds: await shared(Prisma.sql`
      SELECT count(*)::bigint AS n FROM (SELECT "zendeskOrgId" FROM customers WHERE "organizationId" IN (${ids})
        GROUP BY "zendeskOrgId" HAVING count(DISTINCT "organizationId") > 1) x`),
    jiraIssueKeys: await shared(Prisma.sql`
      SELECT count(*)::bigint AS n FROM (SELECT cl."externalId" FROM case_links cl JOIN cases ca ON ca.id = cl."caseId"
        WHERE ca."organizationId" IN (${ids}) AND cl.system = 'jira'
        GROUP BY cl."externalId" HAVING count(DISTINCT ca."organizationId") > 1) x`),
    rawEventProviderIds: await shared(Prisma.sql`
      SELECT count(*)::bigint AS n FROM (SELECT re."providerEventId" FROM raw_events re JOIN integrations i ON i.id = re."integrationId"
        WHERE i."organizationId" IN (${ids})
        GROUP BY re."providerEventId" HAVING count(DISTINCT i."organizationId") > 1) x`),
    webhookSecrets: await shared(Prisma.sql`
      SELECT count(*)::bigint AS n FROM (SELECT "webhookSecret" FROM integrations WHERE "organizationId" IN (${ids})
        GROUP BY "webhookSecret" HAVING count(*) > 1) x`),
    requesterNames: await shared(Prisma.sql`
      SELECT count(*)::bigint AS n FROM (SELECT "requesterName" FROM cases WHERE "organizationId" IN (${ids}) AND "requesterName" IS NOT NULL
        GROUP BY "requesterName" HAVING count(DISTINCT "organizationId") > 1) x`),
    integrationSubdomains: await shared(Prisma.sql`
      SELECT count(*)::bigint AS n FROM (SELECT credentials->>'subdomain' AS s FROM integrations WHERE "organizationId" IN (${ids}) AND provider = 'zendesk'
        GROUP BY credentials->>'subdomain' HAVING count(*) > 1) x`),
  };

  const stray = await prisma.organization.findMany({
    where: { id: { startsWith: "seed-org-", notIn: orgIds } },
    select: { id: true },
  });

  return {
    tenants: reports,
    totals,
    sharedAcrossTenants,
    crossTenantReferences: reports.reduce((sum, r) => sum + r.report.crossTenantReferences, 0),
    strayOrganizations: stray.map((o) => o.id),
  };
}

export interface TenantChecks {
  tenant: TenantDef;
  checks: Check[];
}

export function checkAll(all: AllReport, expectedTenants: number = TENANTS.length): { global: Check[]; tenants: TenantChecks[] } {
  const check = (name: string, ok: boolean, detail: string): Check => ({ name, ok, detail });
  const present = all.tenants.filter((t) => t.organizationExists);
  const reference = present[0]?.report.totals;
  const sameShape = (pick: (t: Report["totals"]) => number) => present.every((t) => pick(t.report.totals) === (reference ? pick(reference) : 0));
  const s = all.sharedAcrossTenants;

  const global: Check[] = [
    check(`exactly ${expectedTenants} organizations`, present.length === expectedTenants, `${present.length}`),
    check("organization names/ids are the deterministic ones", present.every((t) => t.organizationExists), present.map((t) => t.tenant.name).join(" | ")),
    check("no stray seed organizations (e.g. the old single-tenant one)", all.strayOrganizations.length === 0, all.strayOrganizations.join(",") || "none"),
    check("every organization has its own 11 customers", present.every((t) => t.report.totals.customers === 11), present.map((t) => t.report.totals.customers).join(",")),
    check("every organization has the same fixture shape (cases, commitments, evaluations, events)", sameShape((t) => t.cases) && sameShape((t) => t.commitments) && sameShape((t) => t.evaluations) && sameShape((t) => t.normalizedEvents), reference ? `${reference.cases} cases / ${reference.commitments} commitments / ${reference.evaluations} evaluations each` : "-"),
    check("every organization has 2 users and 2 integrations", present.every((t) => t.report.totals.users === 2 && Object.keys(t.report.totals.integrations).length === 2), "2/2 each"),
    check("no case external id shared between tenants", s.caseExternalIds === 0, `${s.caseExternalIds}`),
    check("no Zendesk organization id shared between tenants", s.customerZendeskOrgIds === 0, `${s.customerZendeskOrgIds}`),
    check("no Jira issue key shared between tenants", s.jiraIssueKeys === 0, `${s.jiraIssueKeys}`),
    check("no raw-event provider id shared between tenants", s.rawEventProviderIds === 0, `${s.rawEventProviderIds}`),
    check("no requester shared between tenants", s.requesterNames === 0, `${s.requesterNames}`),
    check("no webhook secret or Zendesk subdomain shared between tenants", s.webhookSecrets === 0 && s.integrationSubdomains === 0, `${s.webhookSecrets}/${s.integrationSubdomains}`),
    check("no cross-tenant references in any organization", all.crossTenantReferences === 0, `${all.crossTenantReferences}`),
  ];
  return { global, tenants: present.map((t) => ({ tenant: t.tenant, checks: checkReport(t.report) })) };
}

export function formatAll(all: AllReport, checks: ReturnType<typeof checkAll>, options: { detail?: string[] } = {}): string {
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);
  const t = all.totals;
  push("== Global totals ==");
  push(`Organizations:      ${t.organizations}`);
  push(`Customers:          ${t.customers}   (${t.organizations} x 11)`);
  push(`Users:              ${t.users}`);
  push(`Integrations:       ${t.integrations}`);
  push(`Cases:              ${t.cases}`);
  push(`Normalized events:  ${t.normalizedEvents}`);
  push(`Raw events:         ${t.rawEvents}`);
  push(`Jira case links:    ${t.caseLinks}`);
  push(`Commitments:        ${t.commitments}`);
  push(`Evaluations:        ${t.evaluations}`);
  push(`Notifications:      ${t.notifications}`);
  push(`Tenant-scoped rows: ${t.totalRecords}`);
  push();
  push("== Per organization ==");
  const header = ["Organization", "Cust", "Cases", "Users", "Integ", "Cmt", "Evals", "Events", "Raw", "Links", "Notif", "Rows", "Checks"];
  const failedByOrg = new Map(checks.tenants.map((c) => [c.tenant.key, c.checks.filter((x) => !x.ok).length]));
  const body = all.tenants.map(({ tenant, report, organizationExists }) => {
    const r = report.totals;
    return [
      tenant.name,
      String(r.customers),
      String(r.cases),
      String(r.users),
      String(Object.keys(r.integrations).length),
      String(r.commitments),
      String(r.evaluations),
      String(r.normalizedEvents),
      String(Object.values(r.rawEvents).reduce((a, b) => a + b, 0)),
      String(r.caseLinks),
      String(r.notifications),
      String(r.totalRecords),
      !organizationExists ? "MISSING" : (failedByOrg.get(tenant.key) ?? 0) === 0 ? "ok" : `${failedByOrg.get(tenant.key)} FAILED`,
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  push(fmt(header));
  push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of body) push(fmt(row));

  for (const key of options.detail ?? []) {
    const found = all.tenants.find((x) => x.tenant.key === key);
    const tenantChecks = checks.tenants.find((x) => x.tenant.key === key);
    if (!found || !tenantChecks) continue;
    push();
    push(`== ${found.tenant.name} (${found.tenant.orgId}) ==`);
    push(formatReport(found.report, tenantChecks.checks));
  }

  push();
  push("== Cross-tenant checks ==");
  for (const c of checks.global) push(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
  const perOrgFailed = checks.tenants.reduce((n, c) => n + c.checks.filter((x) => !x.ok).length, 0);
  const perOrgTotal = checks.tenants.reduce((n, c) => n + c.checks.length, 0);
  const globalFailed = checks.global.filter((c) => !c.ok).length;
  push();
  push(`Per-organization checks: ${perOrgTotal - perOrgFailed}/${perOrgTotal} passed.  Cross-tenant checks: ${checks.global.length - globalFailed}/${checks.global.length} passed.`);
  push(perOrgFailed + globalFailed === 0 ? "ALL CHECKS PASSED." : `${perOrgFailed + globalFailed} CHECK(S) FAILED.`);
  return lines.join("\n");
}
