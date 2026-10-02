/**
 * Monthly report delivery (N5.6) against a real Postgres: the unique key
 * `(organizationId, period, channel)` makes a month deliver once, however many
 * ticks or workers reach it. Needs a migrated database at TEST_DATABASE_URL
 * whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import type { MonthlyReportDeliveryOptions } from "@sla/notifications";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-02T09:00:00Z"); // the report covers September 2026

describe.skipIf(!TEST_DATABASE_URL)("deliverMonthlyReport (real Postgres)", () => {
  let prisma: PrismaClient;
  let deliver: typeof import("@sla/notifications").deliverMonthlyReport;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    deliver = (await import("@sla/notifications")).deliverMonthlyReport;
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const options: MonthlyReportDeliveryOptions = { appUrl: "https://app.example.com", issueLinkProviders: [], now: NOW };
  const org = (createdAt = new Date("2026-01-01T00:00:00Z")) =>
    prisma.organization.create({ data: { name: "Acme", createdAt } });

  it("records an unconfigured channel as skipped, once, and settles on the next tick", async () => {
    const o = await org();
    const first = await deliver(prisma, o.id, options);
    expect(first.period).toBe("2026-09");
    expect(first.channels).toEqual({ email: "skipped", slack: "skipped" });

    const second = await deliver(prisma, o.id, options);
    expect(second.channels).toEqual({ email: "settled", slack: "settled" });
    expect(await prisma.reportDelivery.count({ where: { organizationId: o.id } })).toBe(2);
  });

  it("two concurrent ticks claim a month once: one row per channel, one winner", async () => {
    const o = await org();
    await prisma.slackIntegration.create({
      data: { organizationId: o.id, accessToken: "x", teamId: "T", teamName: "T", botUserId: "B", channelId: "C1" },
    });
    const results = await Promise.all([deliver(prisma, o.id, options), deliver(prisma, o.id, options), deliver(prisma, o.id, options)]);
    const slackOutcomes = results.map((r) => r.channels.slack);
    // A month with no activity is recorded as skipped by exactly one tick; the rest do nothing.
    expect(slackOutcomes.filter((o) => o === "skipped")).toHaveLength(1);
    expect(slackOutcomes.every((o) => o === "skipped" || o === "not_claimed" || o === "settled")).toBe(true);
    expect(await prisma.reportDelivery.count({ where: { organizationId: o.id, channel: "slack" } })).toBe(1);
  });

  it("does nothing, and records nothing, when the operator kill switch is off", async () => {
    const o = await org();
    const result = await deliver(prisma, o.id, { ...options, enabled: false });
    expect(result).toEqual({ period: null, built: false, channels: {} });
    expect(await prisma.reportDelivery.count()).toBe(0);
  });

  it("has nothing to report for a month that ended before the organization existed", async () => {
    const o = await org(new Date("2026-10-01T00:00:00Z"));
    const result = await deliver(prisma, o.id, options);
    expect(result.built).toBe(false);
    expect(await prisma.reportDelivery.count()).toBe(0);
  });

  it("picks the month on the organization's own wall clock", async () => {
    const o = await prisma.organization.create({ data: { name: "Tokyo", timezone: "Asia/Tokyo", createdAt: new Date("2026-01-01T00:00:00Z") } });
    // 2026-09-30T20:00Z is already October 1 in Tokyo, so the report is for September in Tokyo's terms, not August.
    const result = await deliver(prisma, o.id, { ...options, now: new Date("2026-09-30T20:00:00Z") });
    expect(result.period).toBe("2026-09");
  });

  it("writes only the requesting organization's rows", async () => {
    const a = await org();
    const b = await org();
    await deliver(prisma, a.id, options);
    expect(await prisma.reportDelivery.count({ where: { organizationId: b.id } })).toBe(0);
  });
});
