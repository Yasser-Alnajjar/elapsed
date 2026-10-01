/**
 * End to end: the multi-tenant test-customer seed against real Postgres, through the real
 * normalizers, correlators and commitment/evaluation pipelines. Needs a migrated database at
 * TEST_DATABASE_URL whose name contains "test" (every table is truncated); skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type Modules = {
  seed: typeof import("../scripts/seed-test-customers/seed");
  validate: typeof import("../scripts/seed-test-customers/validate");
  config: typeof import("../scripts/seed-test-customers/config");
};

async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
}

/** Everything meaningful about one organization's dataset, minus generated ids and createdAt/updatedAt. */
async function contentFingerprint(prisma: PrismaClient, organizationId: string): Promise<string> {
  const cases = await prisma.case.findMany({
    where: { organizationId },
    orderBy: { externalId: "asc" },
    include: {
      customer: { select: { name: true, tier: true, identities: { select: { externalId: true }, orderBy: { externalId: "asc" } } } },
      caseLinks: { orderBy: { externalId: "asc" } },
      normalizedEvents: { orderBy: [{ occurredAt: "asc" }, { system: "asc" }, { sourceSequence: "asc" }, { type: "asc" }] },
      commitments: {
        orderBy: [{ kind: "asc" }, { cycleKey: "asc" }],
        include: { evaluations: { orderBy: { evaluatedAt: "asc" } }, notifications: true, policyVersion: { include: { policy: true } } },
      },
    },
  });
  return JSON.stringify(
    cases.map((c) => ({
      externalId: c.externalId,
      subject: c.subject,
      requester: c.requesterName,
      priority: c.priority,
      tier: c.tier,
      closedAt: c.closedAt,
      deletedAt: c.deletedAt,
      customer: c.customer,
      links: c.caseLinks.map((l) => [l.externalId, l.method, l.unlinkedAt]),
      events: c.normalizedEvents.map((e) => [e.type, e.occurredAt, e.actor, e.system, e.fromState, e.toState]),
      commitments: c.commitments.map((m) => [
        m.kind,
        m.cycleKey,
        m.startedAt,
        m.targetMinutes,
        m.status,
        m.closedAt,
        m.policyVersion.policy.name,
        m.evaluations.map((e) => [e.evaluatedAt, e.elapsedSeconds, e.status]),
        m.notifications.map((n) => [n.threshold, n.sentAt]),
      ]),
    })),
  );
}

async function connect(): Promise<{ prisma: PrismaClient } & Modules> {
  const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
  // @sla/db builds its connection from DATABASE_URL at import time.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const prisma = (await import("@sla/db")).getPrismaClient();
  return {
    prisma,
    seed: await import("../scripts/seed-test-customers/seed"),
    validate: await import("../scripts/seed-test-customers/validate"),
    config: await import("../scripts/seed-test-customers/config"),
  };
}

// Each seeded tenant drives the whole pipeline (a couple of seconds).
describe.skipIf(!TEST_DATABASE_URL)("seed-test-customers: 11 independent organizations (real Postgres)", { timeout: 300_000 }, () => {
  let prisma: PrismaClient;
  let m: Modules;
  let bystanderId: string;

  beforeAll(async () => {
    const connected = await connect();
    prisma = connected.prisma;
    m = connected;
    await truncateAll(prisma);
    // An unrelated tenant that must come through the seed untouched.
    const other = await prisma.organization.create({ data: { name: "Unrelated Tenant" } });
    bystanderId = other.id;
    const customer = await prisma.customer.create({
      data: {
        organizationId: other.id,
        name: "Bystander Inc",
        identities: { create: { organizationId: other.id, provider: "zendesk", kind: "organization", externalId: "7100000001" } },
      },
    });
    const bystanderZendesk = await prisma.integration.create({ data: { organizationId: other.id, provider: "zendesk", credentials: {} } });
    await prisma.case.create({
      data: {
        organizationId: other.id,
        customerId: customer.id,
        externalId: "41001",
        system: "zendesk",
        sourceIntegrationId: bystanderZendesk.id,
        openedAt: new Date("2026-09-01T00:00:00Z"),
      },
    });
    await m.seed.seedTestCustomers(prisma, { reset: true });
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("creates exactly 11 organizations, with the deterministic names and ids", async () => {
    const orgs = await prisma.organization.findMany({ where: { id: { startsWith: "seed-org-" } }, orderBy: { id: "asc" } });
    expect(orgs).toHaveLength(11);
    expect(orgs.map((o) => [o.id, o.name]).sort()).toEqual(m.config.TENANTS.map((t) => [t.orgId, t.name]).sort());
    expect(orgs.every((o) => o.name.startsWith("Elapsed Fixture — "))).toBe(true);
  });

  it("gives each organization the full fixture, with the 11 Customers inside it (Customers are not Organizations)", async () => {
    const all = await m.validate.collectAll(prisma);
    expect(all.tenants).toHaveLength(11);
    for (const { tenant, report } of all.tenants) {
      const t = report.totals;
      expect(report.customers.map((c) => c.name).sort(), tenant.key).toEqual(m.config.CUSTOMERS.map((c) => c.name).sort());
      expect(t.customers).toBe(11);
      expect(t.cases).toBe(134);
      expect(t.commitments).toBe(350);
      expect(t.evaluations).toBe(522);
      expect(t.normalizedEvents).toBe(858);
      expect(t.caseLinks).toBe(26);
      expect(t.users).toBe(2);
      expect(Object.keys(t.integrations).sort()).toEqual(["jira", "zendesk"]);
      expect(t.notifications).toBe(132);
      expect(t.notificationFailures).toBe(2);
      expect(t.slaPolicies).toEqual({ imported: 11, native: 1 });
      expect(t.calendars).toEqual({ imported: 3, native: 2 });
      expect(t.slaImportSummary).not.toBeNull();
      expect(t.policyChanges).toBe(2);
      expect(t.pendingInvitations).toBe(1);
    }
    // 11 x the dataset, and no orphan rows outside the 11 tenants + the bystander.
    expect(all.totals.customers).toBe(121);
    expect(all.totals.cases).toBe(1474);
    expect(await prisma.case.count()).toBe(1474 + 1);
    expect(await prisma.customer.count()).toBe(121 + 1);
    expect(await prisma.user.count()).toBe(22);
    // 11 tenants x (Zendesk, Jira), plus the bystander's own Zendesk integration.
    expect(await prisma.integration.count()).toBe(22 + 1);
  });

  it("passes every per-organization and cross-tenant validation check", async () => {
    const all = await m.validate.collectAll(prisma);
    const checks = m.validate.checkAll(all);
    const failed = [...checks.global, ...checks.tenants.flatMap((t) => t.checks.map((c) => ({ ...c, name: `${t.tenant.key}: ${c.name}` })))].filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed)).toEqual([]);
  });

  it("keeps every tenant-scoped record inside its own organization", async () => {
    for (const tenant of m.config.TENANTS) {
      const org = tenant.orgId;
      const stray = {
        // Cases whose customer belongs to another organization.
        casesWithForeignCustomer: await prisma.case.count({ where: { organizationId: org, customer: { organizationId: { not: org } } } }),
        // Commitments frozen onto another organization's policy or calendar.
        foreignPolicy: await prisma.commitment.count({ where: { case: { organizationId: org }, policyVersion: { policy: { organizationId: { not: org } } } } }),
        foreignCalendar: await prisma.commitment.count({ where: { case: { organizationId: org }, calendarVersion: { calendar: { organizationId: { not: org } } } } }),
        // Events sourced from another organization's raw events.
        foreignEvents: await prisma.normalizedEvent.count({ where: { case: { organizationId: org }, sourceRawEvent: { integration: { organizationId: { not: org } } } } }),
        // Customers pinned to another organization's calendar.
        foreignOverride: await prisma.customer.count({ where: { organizationId: org, calendar: { organizationId: { not: org } } } }),
        // Policies matching another organization's customers.
        foreignPolicyCustomers: await countPoliciesNamingForeignCustomers(prisma, org),
      };
      expect(stray, tenant.key).toEqual({ casesWithForeignCustomer: 0, foreignPolicy: 0, foreignCalendar: 0, foreignEvents: 0, foreignOverride: 0, foreignPolicyCustomers: 0 });

      // Its own integrations: its own subdomain / site, its own webhook secrets.
      const integrations = await prisma.integration.findMany({ where: { organizationId: org } });
      const zendesk = integrations.find((i) => i.provider === "zendesk")!;
      const jira = integrations.find((i) => i.provider === "jira")!;
      expect((zendesk.credentials as { subdomain: string }).subdomain).toBe(tenant.zendeskSubdomain);
      expect((jira.credentials as { siteUrl: string; cloudId: string }).siteUrl).toBe(tenant.jiraSiteUrl);
      expect(zendesk.webhookSecret).toContain(tenant.key);

      // Its own logins.
      const users = await prisma.user.findMany({ where: { organizationId: org }, orderBy: { role: "asc" } });
      expect(users.map((u) => u.email).sort()).toEqual(tenant.users.map((u) => u.email).sort());
    }
  });

  it("shares no external id, requester, subdomain or secret between tenants", async () => {
    const all = await m.validate.collectAll(prisma);
    expect(all.sharedAcrossTenants).toEqual({
      caseExternalIds: 0,
      customerZendeskOrgIds: 0,
      jiraIssueKeys: 0,
      rawEventProviderIds: 0,
      webhookSecrets: 0,
      requesterNames: 0,
      integrationSubdomains: 0,
    });
    expect(all.crossTenantReferences).toBe(0);
  });

  it("leaves an unrelated organization untouched, even when it uses the same ticket id", async () => {
    expect(await prisma.customer.count({ where: { organizationId: bystanderId } })).toBe(1);
    expect(await prisma.case.count({ where: { organizationId: bystanderId } })).toBe(1);
    expect(await prisma.commitment.count({ where: { case: { organizationId: bystanderId } } })).toBe(0);
    expect(await prisma.integration.count({ where: { organizationId: bystanderId } })).toBe(1);
  });

  it("never sends anything: no credentials config, Slack or SMTP rows, only placeholder tokens", async () => {
    expect(await prisma.integrationConfig.count()).toBe(0);
    expect(await prisma.slackIntegration.count()).toBe(0);
    expect(await prisma.organizationEmailSettings.count()).toBe(0);
    for (const integration of await prisma.integration.findMany({ where: { organizationId: { startsWith: "seed-org-" } } })) {
      expect(JSON.stringify(integration.credentials)).toContain("not-a-credential");
    }
  });
});

/** Policies (any version) whose `match.customerIds` include a customer of another organization. */
async function countPoliciesNamingForeignCustomers(prisma: PrismaClient, organizationId: string): Promise<number> {
  const versions = await prisma.sLAPolicyVersion.findMany({ where: { policy: { organizationId } }, select: { match: true } });
  const named = new Set(versions.flatMap((v) => ((v.match as { customerIds?: string[] }).customerIds ?? [])));
  if (named.size === 0) return 0;
  const own = await prisma.customer.count({ where: { organizationId, id: { in: [...named] } } });
  return named.size - own;
}

describe.skipIf(!TEST_DATABASE_URL)("seed-test-customers: rerun, reset and safety (real Postgres, two tenants)", { timeout: 300_000 }, () => {
  let prisma: PrismaClient;
  let m: Modules;
  const TWO = ["halcyon", "nimbus"];
  const org = (key: string) => `seed-org-${key}`;

  beforeAll(async () => {
    const connected = await connect();
    prisma = connected.prisma;
    m = connected;
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("is safe to rerun in place: nothing duplicated, nothing changed, in every tenant", async () => {
    await m.seed.seedTestCustomers(prisma, { reset: true, tenants: TWO });
    const before = await Promise.all(TWO.map((k) => contentFingerprint(prisma, org(k))));
    const countsBefore = await m.validate.collectAll(prisma, m.seed.selectTenants(TWO));

    const rerun = await m.seed.seedTestCustomers(prisma, { tenants: TWO });
    expect(rerun.tenants.every((t) => t.rawEventsWritten === 0 && t.commitmentsCreated === 0 && t.evaluationsCreated === 0)).toBe(true);

    expect(await Promise.all(TWO.map((k) => contentFingerprint(prisma, org(k))))).toEqual(before);
    const countsAfter = await m.validate.collectAll(prisma, m.seed.selectTenants(TWO));
    expect(countsAfter.totals).toEqual(countsBefore.totals);
    expect(await prisma.organization.count({ where: { id: { startsWith: "seed-org-" } } })).toBe(2);
  });

  it("rebuilds identically after --reset, and resetting one tenant leaves the others alone", async () => {
    await m.seed.seedTestCustomers(prisma, { reset: true, tenants: TWO });
    const [halcyon, nimbus] = await Promise.all(TWO.map((k) => contentFingerprint(prisma, org(k))));
    const nimbusOrgRow = await prisma.organization.findUniqueOrThrow({ where: { id: org("nimbus") } });

    await m.seed.seedTestCustomers(prisma, { reset: true, tenants: ["halcyon"] });
    expect(await contentFingerprint(prisma, org("halcyon"))).toBe(halcyon);
    expect(await contentFingerprint(prisma, org("nimbus"))).toBe(nimbus);
    // Nimbus was not deleted and recreated.
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org("nimbus") } })).createdAt).toEqual(nimbusOrgRow.createdAt);
  });

  it("refuses to rerun over data from a different anchor, and to reset a look-alike organization", async () => {
    await m.seed.seedTestCustomers(prisma, { reset: true, tenants: ["halcyon"] });
    await expect(m.seed.seedTestCustomers(prisma, { anchor: new Date("2026-10-06T15:00:00.000Z"), tenants: ["halcyon"] })).rejects.toThrow(/--reset/);

    await prisma.organization.update({ where: { id: org("halcyon") }, data: { name: "Somebody's Real Org" } });
    await expect(m.seed.seedTestCustomers(prisma, { reset: true, tenants: ["halcyon"] })).rejects.toThrow(/Refusing to delete/);
    expect(await prisma.organization.count({ where: { id: org("halcyon") } })).toBe(1);
  });

  it("removes the old single-tenant seed organization on reset, but only if it is really that one", async () => {
    const legacy = m.config.LEGACY_SEED_ORG;
    await prisma.organization.create({ data: { id: legacy.id, name: legacy.name } });
    await m.seed.seedTestCustomers(prisma, { reset: true, tenants: ["halcyon"] });
    expect(await prisma.organization.count({ where: { id: legacy.id } })).toBe(0);

    await prisma.organization.create({ data: { id: legacy.id, name: "Not The Legacy Seed" } });
    await expect(m.seed.seedTestCustomers(prisma, { reset: true, tenants: ["halcyon"] })).rejects.toThrow(/Refusing to delete/);
  });

  it("rejects an unknown tenant key before touching anything", async () => {
    await expect(m.seed.seedTestCustomers(prisma, { tenants: ["acme"] })).rejects.toThrow(/Unknown tenant/);
    expect(await prisma.organization.count()).toBe(0);
  });
});
