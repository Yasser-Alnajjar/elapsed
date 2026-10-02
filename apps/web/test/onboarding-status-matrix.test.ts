/**
 * N5.1: `getOnboardingStatus` for every ticket source x tracker pair, from the
 * adapter registry. Real Postgres; needs a migrated database at
 * TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const PAIRS = [
  ["zendesk", "jira", "ticket:"],
  ["zendesk", "linear", "ticket:"],
  ["intercom", "jira", "conversation:"],
  ["intercom", "linear", "conversation:"],
] as const;

describe.skipIf(!TEST_DATABASE_URL)("onboarding status across the provider matrix (real Postgres)", () => {
  let prisma: PrismaClient;
  let data: typeof import("../src/lib/onboarding-data");
  let progress: typeof import("../src/lib/onboarding-progress");
  let organizationId: string;
  let otherOrganizationId: string;
  const done = { backfillCompletedAt: "2026-09-01T00:00:00.000Z" };

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    data = await import("../src/lib/onboarding-data");
    progress = await import("../src/lib/onboarding-progress");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    organizationId = (await prisma.organization.create({ data: { name: "Onboarding Matrix Org" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other Org" } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const connect = (orgId: string, provider: "zendesk" | "intercom" | "jira" | "linear", extra: object = {}) =>
    prisma.integration.create({ data: { organizationId: orgId, provider, credentials: {}, ...extra } });

  const snapshot = (integrationId: string, prefix: string, id: string) =>
    prisma.rawEvent.create({
      data: { integrationId, providerEventId: `${prefix}${id}:h`, sourceHash: `h-${id}`, payload: {} },
    });

  const of = (s: Awaited<ReturnType<typeof data.getOnboardingStatus>>, provider: string) =>
    s.providers.find((p) => p.provider === provider)!;

  it("lists every provider in registry order with its role, capabilities and config", async () => {
    const status = await data.getOnboardingStatus(prisma, organizationId);
    expect(status.providers.map((p) => p.provider)).toEqual(["zendesk", "jira", "intercom", "linear", "github"]);
    expect(of(status, "zendesk")).toMatchObject({ role: "ticket_source", label: "Zendesk" });
    expect(of(status, "zendesk").capabilities.policyImport).toBe(true);
    expect(of(status, "intercom").capabilities.policyImport).toBe(false);
    expect(of(status, "github").role).toBe("code_host");
    expect(of(status, "jira").access.scopes).toContain("read:jira-work");
    expect(of(status, "intercom").access.note).toMatch(/Developer Hub/);
    expect(of(status, "zendesk").config).toEqual({ configured: false, clientId: null });
  });

  describe.each(PAIRS)("%s + %s", (source, tracker, prefix) => {
    it("walks from nothing to complete", async () => {
      let status = await data.getOnboardingStatus(prisma, organizationId);
      expect(progress.deriveOnboardingProgress(status)).toMatchObject({ ticketSource: null, complete: false });

      const src = await connect(organizationId, source);
      await snapshot(src.id, prefix, "1");
      await snapshot(src.id, prefix, "2");
      status = await data.getOnboardingStatus(prisma, organizationId);
      expect(of(status, source)).toMatchObject({ connected: true, backfillComplete: false });
      expect(status.ticketsFetched).toBe(2);
      expect(progress.deriveOnboardingProgress(status)).toMatchObject({ ticketSource: source, ticketSourceReady: false });

      await prisma.integration.update({ where: { id: src.id }, data: { cursor: done } });
      status = await data.getOnboardingStatus(prisma, organizationId);
      expect(progress.deriveOnboardingProgress(status)).toMatchObject({ ticketSourceReady: true, tracker: null, complete: false });

      await connect(organizationId, tracker);
      status = await data.getOnboardingStatus(prisma, organizationId);
      expect(progress.deriveOnboardingProgress(status)).toMatchObject({ ticketSource: source, tracker, complete: true });
    });
  });

  it("a disconnected integration is not connected", async () => {
    await connect(organizationId, "zendesk", { status: "disconnected", disconnectedAt: new Date() });
    const status = await data.getOnboardingStatus(prisma, organizationId);
    expect(of(status, "zendesk").connected).toBe(false);
    expect(progress.deriveOnboardingProgress(status).ticketSource).toBeNull();
  });

  it("a connection that needs a reconnect is flagged, and carries the stored subdomain", async () => {
    await prisma.integration.create({
      data: { organizationId, provider: "zendesk", status: "reauth_required", credentials: { subdomain: "acme" } },
    });
    const status = await data.getOnboardingStatus(prisma, organizationId);
    expect(of(status, "zendesk")).toMatchObject({ connected: true, reauthRequired: true, subdomain: "acme" });
  });

  it("counts only this organization's snapshots, escalations and links", async () => {
    const mine = await connect(organizationId, "zendesk");
    const theirs = await connect(otherOrganizationId, "zendesk");
    await snapshot(mine.id, "ticket:", "1");
    await snapshot(theirs.id, "ticket:", "2");
    await snapshot(theirs.id, "ticket:", "3");

    const status = await data.getOnboardingStatus(prisma, organizationId);
    expect(status.ticketsFetched).toBe(1);
    expect(status.escalatedCases).toBe(0);
    expect(status.linkedIssues).toBe(0);
    expect(of(status, "zendesk").connected).toBe(true);

    const other = await data.getOnboardingStatus(prisma, otherOrganizationId);
    expect(other.ticketsFetched).toBe(2);
  });
});
