/**
 * N4.4 read models against a real Postgres: the tenants list and the tenant
 * detail, with two organizations seeded with deliberately different counts so
 * any cross-contamination shows up as a wrong number. Also asserts the number
 * of queries does not grow with the number of tenants (no per-tenant N+1) and
 * that no credential ever reaches a read model.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"
 * (every test truncates all tables). Skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-10-02T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SECRET = "SUPER-SECRET-OAUTH-TOKEN-do-not-leak";

describe.skipIf(!TEST_DATABASE_URL)("admin tenants read models (real Postgres)", () => {
  let prisma: PrismaClient;
  let data: typeof import("../src/lib/admin-tenants-data");
  let coverage: typeof import("../src/lib/link-coverage-data");

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    data = await import("../src/lib/admin-tenants-data");
    coverage = await import("../src/lib/link-coverage-data");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    // Pinned, not bootstrapped from WORKER_ACTIVE_POLL_MS: the freshness window
    // is poll interval x grace, and these tests assert fresh versus stale. 30 s x 3 = 90 s.
    await prisma.workerSettings.create({
      data: { id: "singleton", activePollIntervalMs: 30_000, reconciliationIntervalMs: 1_800_000, freshnessGraceFactor: 3 },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Counts every query sent through the returned client, raw ones included. */
  function counting() {
    let queries = 0;
    const client = prisma.$extends({
      query: {
        $allOperations: async ({ args, query }) => {
          queries += 1;
          return query(args);
        },
      },
    }) as unknown as PrismaClient;
    return { client, count: () => queries };
  }

  interface SeedOptions {
    name: string;
    ownerEmail: string;
    members?: number;
    openCases: number;
    /** Of the open cases, how many carry a certain Jira link. */
    certainLinked: number;
    /** Extra cases that must not count as open, or not in the 30-day window. */
    withNoise?: boolean;
    plan?: string | null;
    planStatus?: "trial" | "active" | "past_due" | "cancelled" | "internal";
    jira?: "failing" | "healthy" | "none";
    evaluations24h: number;
    notificationsSent24h: number;
    notificationsFailing: number;
  }

  async function seedTenant(options: SeedOptions) {
    const organization = await prisma.organization.create({
      data: { name: options.name, plan: options.plan ?? null, planStatus: options.planStatus ?? "trial", billingReference: `inv-${options.name}` },
    });
    const organizationId = organization.id;

    await prisma.user.create({
      data: { organizationId, email: options.ownerEmail, passwordHash: "x", role: "owner" },
    });
    for (let i = 0; i < (options.members ?? 0); i += 1) {
      await prisma.user.create({
        data: { organizationId, email: `member${i}.${options.ownerEmail}`, passwordHash: "x", role: "member" },
      });
    }
    // One pending, one expired, one accepted: only the pending, unexpired one counts.
    await prisma.organizationInvitation.createMany({
      data: [
        { organizationId, email: `p.${options.ownerEmail}`, tokenHash: `${options.name}-p`, status: "pending", expiresAt: new Date(NOW.getTime() + DAY) },
        { organizationId, email: `e.${options.ownerEmail}`, tokenHash: `${options.name}-e`, status: "pending", expiresAt: ago(HOUR) },
        { organizationId, email: `a.${options.ownerEmail}`, tokenHash: `${options.name}-a`, status: "accepted", expiresAt: new Date(NOW.getTime() + DAY) },
      ],
    });

    const zendeskId = await sourceIntegration(prisma, organizationId, "zendesk");
    await prisma.integration.update({
      where: { id: zendeskId },
      data: { credentials: { accessToken: SECRET, subdomain: "acme" }, lastSuccessfulSyncAt: ago(30_000), cursor: { backfillCompletedAt: "2026-09-01T00:00:00.000Z", accessToken: SECRET } },
    });
    if (options.jira && options.jira !== "none") {
      await prisma.integration.create({
        data: {
          organizationId,
          provider: "jira",
          credentials: { accessToken: SECRET },
          lastSuccessfulSyncAt: options.jira === "failing" ? ago(2 * HOUR) : ago(20_000),
          failingSince: options.jira === "failing" ? ago(2 * HOUR) : null,
          consecutiveFailures: options.jira === "failing" ? 7 : 0,
          lastSyncError: options.jira === "failing" ? "Jira is down" : null,
        },
      });
    }
    // A disconnected integration is listed but is not part of the provider pair.
    await prisma.integration.create({
      data: { organizationId, provider: "github", status: "disconnected", credentials: { accessToken: SECRET } },
    });
    await prisma.integrationConfig.create({
      data: { organizationId, provider: "jira", clientId: "id", clientSecret: SECRET },
    });

    const calendar = await prisma.businessCalendar.create({
      data: { organizationId, name: "24/7", versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } } },
      include: { versions: true },
    });
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "Policy" } });
    const version = await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {},
        targets: [{ kind: "resolution", minutes: 60 }],
        pauseOnStates: [],
        calendarVersionId: calendar.versions[0]!.id,
        warnAtPercent: [50],
        effectiveFrom: ago(60 * DAY),
      },
    });

    const caseIds: string[] = [];
    for (let i = 0; i < options.openCases; i += 1) {
      const row = await prisma.case.create({
        data: {
          organizationId,
          system: "zendesk",
          sourceIntegrationId: zendeskId,
          externalId: `${options.name}-T${i}`,
          subject: `Private subject ${options.name} ${i}`,
          openedAt: ago((i + 1) * DAY),
        },
      });
      caseIds.push(row.id);
      if (i < options.certainLinked) {
        await prisma.caseLink.create({
          data: { caseId: row.id, system: "jira", externalId: `${options.name}-J${i}`, method: "official_link", confidence: "certain" },
        });
      }
    }
    if (options.withNoise) {
      // Not open (closed), deleted, and older than the coverage window; a probable link,
      // an unlinked certain link and a certain link to a ticket source never count.
      const closed = await prisma.case.create({
        data: { organizationId, system: "zendesk", sourceIntegrationId: zendeskId, externalId: `${options.name}-closed`, openedAt: ago(2 * DAY), closedAt: ago(DAY) },
      });
      await prisma.case.create({
        data: { organizationId, system: "zendesk", sourceIntegrationId: zendeskId, externalId: `${options.name}-deleted`, openedAt: ago(2 * DAY), deletedAt: ago(DAY) },
      });
      await prisma.case.create({
        data: { organizationId, system: "zendesk", sourceIntegrationId: zendeskId, externalId: `${options.name}-old`, openedAt: ago(45 * DAY) },
      });
      await prisma.caseLink.create({ data: { caseId: closed.id, system: "jira", externalId: "p", method: "pattern", confidence: "probable" } });
      await prisma.caseLink.create({
        data: { caseId: closed.id, system: "jira", externalId: "u", method: "official_link", confidence: "certain", unlinkedAt: ago(HOUR) },
      });
      await prisma.caseLink.create({ data: { caseId: closed.id, system: "zendesk", externalId: "z", method: "official_link", confidence: "certain" } });
    }

    // One commitment on the first case carries all the evaluation and alert rows.
    if (caseIds[0]) {
      const commitment = await prisma.commitment.create({
        data: {
          caseId: caseIds[0],
          kind: "resolution",
          policyVersionId: version.id,
          calendarVersionId: calendar.versions[0]!.id,
          startedAt: ago(DAY),
          targetMinutes: 60,
          dueAt: ago(DAY - HOUR),
        },
      });
      const evaluation = (createdAt: Date) => ({
        commitmentId: commitment.id,
        evaluatedAt: createdAt,
        elapsedSeconds: 1,
        remainingSeconds: 1,
        status: "on_track" as const,
        inputs: {},
        createdAt,
      });
      await prisma.evaluation.createMany({
        data: [
          ...Array.from({ length: options.evaluations24h }, () => evaluation(ago(HOUR))),
          evaluation(ago(3 * DAY)), // outside the window
        ],
      });
      await prisma.notification.createMany({
        data: [
          ...Array.from({ length: options.notificationsSent24h }, (_, i) => ({ commitmentId: commitment.id, threshold: 10 + i, channel: "slack", sentAt: ago(HOUR) })),
          { commitmentId: commitment.id, threshold: 99, channel: "slack", sentAt: ago(3 * DAY) },
        ],
      });
      await prisma.notificationFailure.createMany({
        data: [
          ...Array.from({ length: options.notificationsFailing }, (_, i) => ({
            commitmentId: commitment.id,
            threshold: 200 + i,
            error: "channel_not_found",
            attempts: 3,
            firstFailedAt: ago(2 * HOUR),
            lastFailedAt: ago(HOUR),
          })),
          { commitmentId: commitment.id, threshold: 300, error: "old failure", attempts: 1, firstFailedAt: ago(3 * DAY), lastFailedAt: ago(3 * DAY) },
        ],
      });
    }

    await prisma.organizationWorkState.create({
      data: {
        organizationId,
        lastStartedAt: ago(10 * 60_000),
        lastFinishedAt: new Date(ago(10 * 60_000).getTime() + 4_200),
        consecutiveFailures: options.jira === "failing" ? 2 : 0,
        lastError: options.jira === "failing" ? "ingest:jira: Jira is down" : null,
        activeNextDueAt: new Date(NOW.getTime() + 30_000),
      },
    });
    await prisma.slaImportSummary.create({
      data: { organizationId, provider: "zendesk", unsupportedMetrics: 2, casesWithNoMatchingPolicy: 1 },
    });

    return organizationId;
  }

  async function seedTwoTenants() {
    const alpha = await seedTenant({
      name: "Alpha",
      ownerEmail: "owner@alpha.test",
      members: 2,
      openCases: 4,
      certainLinked: 3,
      withNoise: true,
      plan: "team",
      planStatus: "active",
      jira: "healthy",
      evaluations24h: 5,
      notificationsSent24h: 2,
      notificationsFailing: 0,
    });
    const bravo = await seedTenant({
      name: "Bravo",
      ownerEmail: "owner@bravo.test",
      members: 0,
      openCases: 7,
      certainLinked: 1,
      plan: null,
      planStatus: "trial",
      jira: "failing",
      evaluations24h: 11,
      notificationsSent24h: 0,
      notificationsFailing: 3,
    });
    return { alpha, bravo };
  }

  describe("tenants list", () => {
    it("shows each tenant's own figures, with no cross-contamination", async () => {
      const { alpha, bravo } = await seedTwoTenants();

      const list = await data.getAdminTenantsData(prisma, NOW);
      const a = list.tenants.find((t) => t.organizationId === alpha)!;
      const b = list.tenants.find((t) => t.organizationId === bravo)!;

      expect(list.tenants.map((t) => t.name)).toEqual(["Alpha", "Bravo"]);

      expect(a).toMatchObject({
        name: "Alpha",
        ownerEmail: "owner@alpha.test",
        memberCount: 3,
        pendingInvitations: 1,
        plan: "team",
        planStatus: "active",
        billingReference: "inv-Alpha",
        // The closed, deleted and old cases are not open; the closed case is the only one that was open but ended.
        openCases: 4 + 1 /* old, still open */,
        evaluations24h: 5,
        notificationsSent24h: 2,
        notificationsFailed24h: 0,
        health: "healthy",
      });
      expect(b).toMatchObject({
        name: "Bravo",
        ownerEmail: "owner@bravo.test",
        memberCount: 1,
        pendingInvitations: 1,
        plan: null,
        planStatus: "trial",
        openCases: 7,
        evaluations24h: 11,
        notificationsSent24h: 0,
        notificationsFailed24h: 3,
        health: "unhealthy",
      });
    });

    it("link coverage counts only certain, active, tracker links on cases opened in the last 30 days", async () => {
      const { alpha, bravo } = await seedTwoTenants();

      const list = await data.getAdminTenantsData(prisma, NOW);
      // Alpha: 4 open cases in the window (3 certain-linked) + the closed case (2 d old, with only
      // probable/unlinked/ticket-source links, so not linked); the deleted and 45-day-old cases are out.
      expect(list.tenants.find((t) => t.organizationId === alpha)!.linkCoverage).toEqual({
        cases: 5,
        linkedCases: 3,
        ratio: 3 / 5,
      });
      expect(list.tenants.find((t) => t.organizationId === bravo)!.linkCoverage).toEqual({
        cases: 7,
        linkedCases: 1,
        ratio: 1 / 7,
      });
    });

    it("lists integrations with provider, role, status and freshness, and the failing one makes the tenant unhealthy", async () => {
      const { bravo } = await seedTwoTenants();

      const b = (await data.getAdminTenantsData(prisma, NOW)).tenants.find((t) => t.organizationId === bravo)!;
      expect(b.integrations.map((i) => [i.provider, i.role, i.status])).toEqual([
        ["zendesk", "ticket_source", "connected"],
        ["jira", "work_tracker", "connected"],
        ["github", "code_host", "disconnected"],
      ]);
      const jira = b.integrations.find((i) => i.provider === "jira")!;
      expect(jira).toMatchObject({ failingSince: ago(2 * HOUR).toISOString(), lastSyncError: "Jira is down", stale: true });
      expect(jira.staleSince).not.toBeNull();
    });

    it("reports plan-status counts, plans not recorded, and provider pairs as counts only", async () => {
      await seedTwoTenants();

      const list = await data.getAdminTenantsData(prisma, NOW);

      expect(list.planStatusCounts).toEqual({ trial: 1, active: 1, past_due: 0, cancelled: 0, internal: 0 });
      expect(list.planNotRecorded).toBe(1);
      // Both tenants use Zendesk + Jira (the disconnected GitHub row is not part of the pair).
      expect(list.providerPairCounts).toEqual([{ pair: "Zendesk + Jira", tenants: 2 }]);
      expect(JSON.stringify(list.providerPairCounts)).not.toMatch(/Alpha|Bravo/);
    });

    it("never returns a credential, a client secret or a cursor", async () => {
      await seedTwoTenants();

      const list = await data.getAdminTenantsData(prisma, NOW);

      const text = JSON.stringify(list);
      expect(text).not.toContain(SECRET);
      expect(text).not.toMatch(/credentials|clientSecret|accessToken|cursor/i);
    });

    it("an organization with no integrations is 'none', not healthy", async () => {
      await prisma.organization.create({ data: { name: "Empty" } });

      const list = await data.getAdminTenantsData(prisma, NOW);

      expect(list.tenants[0]).toMatchObject({ name: "Empty", health: "none", ownerEmail: null, memberCount: 0, openCases: 0 });
      expect(list.providerPairCounts).toEqual([{ pair: "No integrations", tenants: 1 }]);
    });

    it("runs a fixed number of queries however many tenants there are", async () => {
      await seedTwoTenants();
      const two = counting();
      await data.getAdminTenantsData(two.client, NOW);

      for (let i = 0; i < 6; i += 1) {
        await seedTenant({
          name: `Extra${i}`,
          ownerEmail: `owner@extra${i}.test`,
          openCases: 2,
          certainLinked: 1,
          jira: "healthy",
          evaluations24h: 1,
          notificationsSent24h: 1,
          notificationsFailing: 1,
        });
      }
      const eight = counting();
      const list = await data.getAdminTenantsData(eight.client, NOW);

      expect(list.tenants).toHaveLength(8);
      expect(eight.count()).toBe(two.count());
      expect(eight.count()).toBeLessThanOrEqual(15);
    });
  });

  describe("tenant detail", () => {
    it("is scoped to one tenant: another tenant's data never appears", async () => {
      const { alpha } = await seedTwoTenants();

      const detail = await data.getAdminTenantDetail(prisma, alpha, NOW);

      expect(detail!.tenant.name).toBe("Alpha");
      const text = JSON.stringify(detail);
      expect(text).not.toMatch(/Bravo/);
      expect(text).not.toContain("owner@bravo.test");
      expect(detail!.tenant).toMatchObject({ openCases: 5, evaluations24h: 5, notificationsSent24h: 2, notificationsFailed24h: 0 });
    });

    it("per-integration health, backfill completion from the cursor, and nothing secret", async () => {
      const { bravo } = await seedTwoTenants();

      const detail = (await data.getAdminTenantDetail(prisma, bravo, NOW))!;

      const zendesk = detail.integrations.find((i) => i.provider === "zendesk")!;
      expect(zendesk.backfillCompletedAt).toBe("2026-09-01T00:00:00.000Z");
      const jira = detail.integrations.find((i) => i.provider === "jira")!;
      expect(jira).toMatchObject({
        status: "connected",
        lastSyncError: "Jira is down",
        consecutiveFailures: 7,
        failingSince: ago(2 * HOUR).toISOString(),
        backfillCompletedAt: null,
        pollingPausedAt: null,
        renormalizeRequestedAt: null,
      });
      expect(JSON.stringify(detail)).not.toContain(SECRET);
    });

    it("lists recent alert failures by ticket id, never the subject, and counts the rest", async () => {
      const { bravo } = await seedTwoTenants();

      const detail = (await data.getAdminTenantDetail(prisma, bravo, NOW))!;

      expect(detail.failingAlertCount).toBe(4); // 3 recent + 1 old, all still failing
      expect(detail.recentAlertFailures).toHaveLength(4);
      expect(detail.recentAlertFailures[0]).toMatchObject({ externalId: "Bravo-T0", kind: "resolution", error: "channel_not_found" });
      expect(JSON.stringify(detail)).not.toContain("Private subject");
    });

    it("reports cases with no matching policy (open, not deleted, no commitment), the policy import and the worker run", async () => {
      const { alpha, bravo } = await seedTwoTenants();

      const a = (await data.getAdminTenantDetail(prisma, alpha, NOW))!;
      // Only the first case has a commitment: 5 open cases (4 + the 45-day-old one) minus 1.
      expect(a.casesWithNoMatchingPolicy).toBe(4);
      expect(a.slaImport).toMatchObject({ provider: "zendesk", unsupportedMetrics: 2, casesWithNoMatchingPolicy: 1 });
      expect(a.work).toMatchObject({ lastRunDurationMs: 4_200, consecutiveFailures: 0, lastError: null });

      const b = (await data.getAdminTenantDetail(prisma, bravo, NOW))!;
      expect(b.casesWithNoMatchingPolicy).toBe(6);
      expect(b.work).toMatchObject({ consecutiveFailures: 2, lastError: "ingest:jira: Jira is down" });
    });

    it("an unknown organization is null", async () => {
      expect(await data.getAdminTenantDetail(prisma, "no-such-org", NOW)).toBeNull();
    });
  });

  describe("link coverage (shared with N5)", () => {
    it("can be restricted to some organizations, and gives each of them an entry", async () => {
      const { alpha } = await seedTwoTenants();
      const empty = (await prisma.organization.create({ data: { name: "Quiet" } })).id;

      const result = await coverage.getLinkCoverage(prisma, { organizationIds: [alpha, empty], now: NOW });

      expect([...result.keys()].sort()).toEqual([alpha, empty].sort());
      expect(result.get(empty)).toEqual({ cases: 0, linkedCases: 0, ratio: null });
      expect(result.get(alpha)).toEqual({ cases: 5, linkedCases: 3, ratio: 3 / 5 });
    });

    it("uses two queries however many organizations it covers", async () => {
      await seedTwoTenants();
      const { client, count } = counting();

      await coverage.getLinkCoverage(client, { now: NOW });

      expect(count()).toBe(2);
    });
  });
});
