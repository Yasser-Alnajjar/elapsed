/**
 * N5.5: the customer's link coverage panel. It reuses `getLinkCoverage` (so it
 * agrees with the platform admin), never counts a `probable` link as covered,
 * and lists the cases behind the gap. Real Postgres; needs a migrated database
 * at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-10-02T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe.skipIf(!TEST_DATABASE_URL)("link coverage panel (real Postgres)", () => {
  let prisma: PrismaClient;
  let data: typeof import("../src/lib/link-coverage-data");
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    data = await import("../src/lib/link-coverage-data");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    orgA = (await prisma.organization.create({ data: { name: "A" } })).id;
    orgB = (await prisma.organization.create({ data: { name: "B" } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function addCase(organizationId: string, externalId: string, openedAgo: number, extra: object = {}) {
    const source = await prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: "zendesk" } },
      create: { organizationId, provider: "zendesk" },
      update: {},
    });
    return prisma.case.create({
      data: { organizationId, system: "zendesk", sourceIntegrationId: source.id, externalId, subject: `Subject ${externalId}`, openedAt: ago(openedAgo), ...extra },
    });
  }

  const link = (caseId: string, confidence: "certain" | "probable", extra: object = {}) =>
    prisma.caseLink.create({
      data: { caseId, system: "jira", externalId: `J-${caseId.slice(-4)}-${confidence}`, method: confidence === "certain" ? "official_link" : "pattern", confidence, ...extra },
    });

  it("counts certain links only, lists the gap, and reports probable-only cases apart", async () => {
    const certain = await addCase(orgA, "1", DAY);
    await link(certain.id, "certain");
    const probable = await addCase(orgA, "2", 2 * DAY);
    await link(probable.id, "probable");
    await addCase(orgA, "3", 3 * DAY); // no link
    const unlinkedLater = await addCase(orgA, "4", 4 * DAY);
    await link(unlinkedLater.id, "certain", { unlinkedAt: ago(DAY) }); // a removed link does not count
    await addCase(orgA, "old", 45 * DAY); // outside the window
    await addCase(orgA, "deleted", DAY, { deletedAt: ago(DAY) });

    const panel = await data.getLinkCoveragePanel(prisma, orgA, NOW);

    expect(panel).toMatchObject({ cases: 4, linkedCases: 1, ratio: 0.25, windowDays: 30, probableOnlyCases: 1, uncoveredOverflowCount: 0 });
    expect(panel.uncovered.map((c) => c.externalId)).toEqual(["2", "3", "4"]); // most recent first
    expect(panel.uncovered.find((c) => c.externalId === "2")?.hasProbableLink).toBe(true);
    expect(panel.uncovered.find((c) => c.externalId === "3")?.hasProbableLink).toBe(false);
  });

  it("is the same number the platform admin reads", async () => {
    const a = await addCase(orgA, "1", DAY);
    await link(a.id, "certain");
    await addCase(orgA, "2", DAY);

    const panel = await data.getLinkCoveragePanel(prisma, orgA, NOW);
    const shared = (await data.getLinkCoverage(prisma, { organizationIds: [orgA], now: NOW })).get(orgA)!;
    expect({ cases: panel.cases, linkedCases: panel.linkedCases, ratio: panel.ratio }).toEqual(shared);
  });

  it("caps the list and reports the overflow", async () => {
    for (let i = 0; i < 11; i += 1) await addCase(orgA, `u${i}`, (i + 1) * 60_000);

    const panel = await data.getLinkCoveragePanel(prisma, orgA, NOW);
    expect(panel.cases).toBe(11);
    expect(panel.uncovered).toHaveLength(8);
    expect(panel.uncoveredOverflowCount).toBe(3);
  });

  it("has no ratio when there are no cases, and never reads another organization's", async () => {
    const other = await addCase(orgB, "b1", DAY);
    await link(other.id, "certain");

    expect(await data.getLinkCoveragePanel(prisma, orgA, NOW)).toMatchObject({ cases: 0, linkedCases: 0, ratio: null, uncovered: [], probableOnlyCases: 0 });
    expect(await data.getLinkCoveragePanel(prisma, orgB, NOW)).toMatchObject({ cases: 1, linkedCases: 1, ratio: 1 });
  });
});
