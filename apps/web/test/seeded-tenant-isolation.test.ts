/**
 * Multi-tenant fixture isolation, end to end through the app's own read paths.
 *
 * Seeds three of the 11 fixture organizations (each a full Zendesk <-> Jira dataset with the same 11
 * Customers) with the real seed, then — for each — signs in through the real NextAuth credentials
 * provider (real bcrypt, real `User` lookup) and exercises the real data helpers and API routes with
 * the session that login produces. Every result must contain only that organization's rows and none of
 * the other two's, and another organization's case id must resolve to nothing.
 *
 * Complements tenant-isolation.test.ts (hand-built orgs, also covers writes) by proving the seeded
 * multi-tenant fixture is itself isolated. Needs a migrated Postgres at TEST_DATABASE_URL whose name
 * contains "test" (every table is truncated); skipped when unset.
 */
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
/** The fixture password (see SEED_PASSWORD_HASH in the seed config). */
const FIXTURE_PASSWORD = "Elapsed#2026";
const TENANT_KEYS = ["halcyon", "nimbus", "cobalt"];

const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  getServerSession: vi.fn(async () => auth.session),
}));
// `server-only` throws unless bundled for React Server Components.
vi.mock("server-only", () => ({}));

interface Tenant {
  key: string;
  orgId: string;
  name: string;
  ownerEmail: string;
  memberEmail: string;
  /** Ids and names that exist only in this tenant. */
  markers: { ticketIds: string[]; jiraKeys: string[]; requesters: string[]; hosts: string[]; caseIds: string[] };
}

/** A whole-token match of any marker, so ticket 41001 is not "found" inside 141001. */
function tokenRegex(values: string[]): RegExp {
  const escaped = values.filter(Boolean).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\w.-])(?:${escaped.join("|")})(?![\\w-])`, "i");
}

describe.skipIf(!TEST_DATABASE_URL)("seeded multi-tenant fixture isolation (real Postgres, real login)", { timeout: 300_000 }, () => {
  let prisma: PrismaClient;
  let tenants: Tenant[];
  let lib: {
    getDashboardData: typeof import("../src/lib/dashboard-data").getDashboardData;
    getCaseDetailData: typeof import("../src/lib/case-detail-data").getCaseDetailData;
    getCaseListData: typeof import("../src/lib/case-list-data").getCaseListData;
    getAtRiskData: typeof import("../src/lib/at-risk-data").getAtRiskData;
    getComplianceReportRows: typeof import("../src/lib/report-data").getComplianceReportRows;
    getFindingsData: typeof import("../src/lib/findings-data").getFindingsData;
    getSlaPolicies: typeof import("../src/lib/sla-policies-data").getSlaPolicies;
    getBusinessCalendars: typeof import("../src/lib/customer-calendars-data").getBusinessCalendars;
    getCustomerCalendarSummaries: typeof import("../src/lib/customer-calendars-data").getCustomerCalendarSummaries;
    getIntegrationsData: typeof import("../src/lib/integrations-data").getIntegrationsData;
  };
  let routes: {
    casesExport: typeof import("../src/app/api/cases/export/route");
    reportCsv: typeof import("../src/app/api/reports/commitments/route");
  };
  let authOptions: typeof import("../src/lib/auth").authOptions;
  const now = new Date("2026-09-29T15:00:00.000Z");

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    // @sla/db builds its connection from DATABASE_URL at import time.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXTAUTH_SECRET ??= "seeded-tenant-isolation-test-secret";
    process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY ??= "seeded-tenant-isolation-integration-key";
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ??= "seeded-tenant-isolation-token-key";
    process.env.SMTP_ENCRYPTION_KEY ??= "seeded-tenant-isolation-smtp-key";

    prisma = (await import("@sla/db")).getPrismaClient();
    lib = {
      ...(await import("../src/lib/dashboard-data")),
      ...(await import("../src/lib/case-detail-data")),
      ...(await import("../src/lib/case-list-data")),
      ...(await import("../src/lib/at-risk-data")),
      ...(await import("../src/lib/report-data")),
      ...(await import("../src/lib/findings-data")),
      ...(await import("../src/lib/sla-policies-data")),
      ...(await import("../src/lib/customer-calendars-data")),
      ...(await import("../src/lib/integrations-data")),
    };
    routes = {
      casesExport: await import("../src/app/api/cases/export/route"),
      reportCsv: await import("../src/app/api/reports/commitments/route"),
    };
    ({ authOptions } = await import("../src/lib/auth"));

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);

    // The real seed, three tenants of it.
    const seed = await import("../../worker/scripts/seed-test-customers/seed");
    await seed.seedTestCustomers(prisma, { reset: true, tenants: TENANT_KEYS });

    const defs = seed.selectTenants(TENANT_KEYS);
    tenants = [];
    for (const def of defs) {
      const cases = await prisma.case.findMany({ where: { organizationId: def.orgId }, select: { id: true, externalId: true, requesterName: true } });
      const links = await prisma.caseLink.findMany({ where: { case: { organizationId: def.orgId } }, select: { externalId: true } });
      tenants.push({
        key: def.key,
        orgId: def.orgId,
        name: def.name,
        ownerEmail: def.users[0]!.email,
        memberEmail: def.users[1]!.email,
        markers: {
          ticketIds: cases.map((c) => c.externalId),
          jiraKeys: [...new Set(links.map((l) => l.externalId))],
          requesters: [...new Set(cases.map((c) => c.requesterName).filter((n): n is string => n !== null))],
          hosts: [def.zendeskSubdomain, def.staleZendeskSubdomain, def.jiraSiteUrl.replace("https://", "")],
          caseIds: cases.map((c) => c.id),
        },
      });
    }
  }, 300_000);

  afterAll(async () => {
    auth.session = null;
    await prisma?.$disconnect();
  });

  /** Signs in through the real credentials provider and returns the session the app would hold for that user. */
  async function signIn(email: string, password: string = FIXTURE_PASSWORD): Promise<Session | null> {
    const provider = authOptions.providers.find((p) => p.type === "credentials") as unknown as {
      options: { authorize: (credentials: Record<string, string>, req: unknown) => Promise<Record<string, unknown> | null> };
    };
    const user = await provider.options.authorize({ email, password }, { headers: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200)}` } });
    if (!user) return null;
    return {
      expires: new Date(Date.now() + 3_600_000).toISOString(),
      user: {
        id: user.id as string,
        organizationId: user.organizationId as string,
        email: user.email as string,
        emailVerifiedAt: user.emailVerifiedAt as Date,
        name: (user.name as string | null) ?? null,
        image: null,
        role: user.role as "owner" | "member",
        createdAt: user.createdAt as Date,
      },
    };
  }

  const foreignOf = (tenant: Tenant) => tenants.filter((t) => t.key !== tenant.key);
  const foreignMarkers = (tenant: Tenant) => {
    const others = foreignOf(tenant);
    return tokenRegex([
      ...others.flatMap((t) => t.markers.ticketIds),
      ...others.flatMap((t) => t.markers.jiraKeys),
      ...others.flatMap((t) => t.markers.requesters),
      ...others.flatMap((t) => t.markers.hosts),
      ...others.map((t) => t.name),
      ...others.flatMap((t) => [t.ownerEmail, t.memberEmail]),
    ]);
  };
  const expectNoForeignData = (tenant: Tenant, result: unknown) => {
    const text = typeof result === "string" ? result : JSON.stringify(result);
    const hit = foreignMarkers(tenant).exec(text);
    expect(hit?.[0] ?? null, `another tenant's data leaked into ${tenant.key}`).toBeNull();
  };

  it("the fixture logins resolve to their own organization, and only with the right password", async () => {
    for (const tenant of tenants) {
      const owner = await signIn(tenant.ownerEmail);
      expect(owner?.user.organizationId).toBe(tenant.orgId);
      expect(owner?.user.role).toBe("owner");
      const member = await signIn(tenant.memberEmail);
      expect(member?.user.organizationId).toBe(tenant.orgId);
      expect(member?.user.role).toBe("member");
    }
    expect(await signIn(tenants[0]!.ownerEmail, "not-the-password")).toBeNull();
    // Another tenant's address is a different account: no shared login across organizations.
    expect(new Set(tenants.flatMap((t) => [t.ownerEmail, t.memberEmail])).size).toBe(tenants.length * 2);
  });

  it("logged in as one organization, every read helper returns only that organization's data", async () => {
    for (const tenant of tenants) {
      const session = (await signIn(tenant.ownerEmail))!;
      const orgId = session.user.organizationId;
      expect(orgId).toBe(tenant.orgId);

      const caseList = await lib.getCaseListData(prisma, orgId, { pageSize: undefined });
      const listed = caseList.cases.map((c) => c.externalId).sort();
      // 134 seeded cases, one soft-deleted (hidden from the default list) — and every one of them ours.
      expect(listed).toHaveLength(133);
      expect(new Set(listed).size).toBe(133);
      expect(listed.every((id) => tenant.markers.ticketIds.includes(id))).toBe(true);
      expect(caseList.cases.filter((c) => c.customerName !== null).length).toBeGreaterThan(100);

      expectNoForeignData(tenant, caseList);
      expectNoForeignData(tenant, await lib.getDashboardData(prisma, orgId, now));
      expectNoForeignData(tenant, await lib.getAtRiskData(prisma, orgId, {}, now));
      expectNoForeignData(tenant, await lib.getComplianceReportRows(prisma, orgId, now));
      expectNoForeignData(tenant, await lib.getFindingsData(prisma, orgId, now));
      expectNoForeignData(tenant, await lib.getSlaPolicies(prisma, orgId));
      expectNoForeignData(tenant, await lib.getBusinessCalendars(prisma, orgId));
      expectNoForeignData(tenant, await lib.getCustomerCalendarSummaries(prisma, orgId));
      expectNoForeignData(tenant, await lib.getIntegrationsData(prisma, orgId));

      const dashboard = await lib.getDashboardData(prisma, orgId, now);
      expect(dashboard.breachedThisPeriod.total).toBeGreaterThan(0);
    }
  });

  it("a case from another organization is not reachable, even by its exact id", async () => {
    for (const tenant of tenants) {
      const orgId = (await signIn(tenant.ownerEmail))!.user.organizationId;
      const own = await lib.getCaseDetailData(prisma, orgId, tenant.markers.caseIds[0]!, now);
      expect(own).not.toBeNull();
      expectNoForeignData(tenant, own);
      for (const other of foreignOf(tenant)) {
        for (const foreignCaseId of other.markers.caseIds) {
          expect(await lib.getCaseDetailData(prisma, orgId, foreignCaseId, now)).toBeNull();
        }
      }
    }
  });

  it("the export routes, called with that organization's session, return only its rows", async () => {
    for (const tenant of tenants) {
      auth.session = await signIn(tenant.ownerEmail);

      const cases = await routes.casesExport.GET(new NextRequest("http://localhost/api/cases/export"));
      expect(cases.status).toBe(200);
      const csv = await cases.text();
      expectNoForeignData(tenant, csv);
      expect(tokenRegex(tenant.markers.ticketIds).test(csv)).toBe(true);

      const report = await routes.reportCsv.GET(new NextRequest("http://localhost/api/reports/commitments?format=json"));
      expect(report.status).toBe(200);
      const json = await report.text();
      expectNoForeignData(tenant, json);
      expect(Array.isArray(JSON.parse(json))).toBe(true);
    }
    auth.session = null;
  });

  it("control: the leak detector really fires when one tenant's data is judged as another's", async () => {
    const [a, b] = tenants as [Tenant, Tenant];
    const bsCases = await lib.getCaseListData(prisma, b.orgId, { pageSize: undefined });
    expect(() => expectNoForeignData(a, bsCases)).toThrow(/leaked/);
    expect(() => expectNoForeignData(a, `ticket ${b.markers.ticketIds[0]} requested by ${b.markers.requesters[0]}`)).toThrow(/leaked/);
    expect(() => expectNoForeignData(a, `ticket ${a.markers.ticketIds[0]} requested by ${a.markers.requesters[0]}`)).not.toThrow();
  });

  it("the same user cannot be reached from another tenant's session: a signed-out request gets nothing", async () => {
    auth.session = null;
    const response = await routes.casesExport.GET(new NextRequest("http://localhost/api/cases/export"));
    expect(response.status).toBe(401);
  });
});
