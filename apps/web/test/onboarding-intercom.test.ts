/**
 * N1.16: an Intercom-only organization can move through onboarding — the
 * status reader sees Intercom and Linear, and the connect-time projection
 * (`projectAndEvaluateSourceSyncs`) normalizes Intercom conversations and
 * defers evaluation until every connected source has finished backfilling.
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL; skipped when
 * unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("onboarding with an Intercom-only organization (real Postgres)", () => {
  let prisma: PrismaClient;
  let onboardingData: typeof import("../src/lib/onboarding-data");
  let progress: typeof import("../src/lib/onboarding-progress");
  let sourceSync: typeof import("../src/lib/source-sync");
  let intercom: typeof import("@sla/intercom");

  let organizationId: string;
  const done = { backfillCompletedAt: "2026-09-01T00:00:00.000Z" };

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    onboardingData = await import("../src/lib/onboarding-data");
    progress = await import("../src/lib/onboarding-progress");
    sourceSync = await import("../src/lib/source-sync");
    intercom = await import("@sla/intercom");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    organizationId = (await prisma.organization.create({ data: { name: "Intercom Onboarding Org" } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const connect = (provider: "intercom" | "linear" | "jira", cursor?: object) =>
    prisma.integration.create({ data: { organizationId, provider, credentials: {}, ...(cursor ? { cursor } : {}) } });

  async function seedConversation(integrationId: string, id: string) {
    const raw = intercom.mapConversationToRawEvent({
      id,
      created_at: 1_790_000_000,
      updated_at: 1_790_000_100,
      state: "open",
      source: { type: "conversation", author: { type: "user", id: "u1" } },
      contacts: { contacts: [{ id: "u1" }] },
    } as never);
    await prisma.rawEvent.create({
      data: { integrationId, providerEventId: raw.providerEventId, sourceHash: raw.sourceHash, payload: raw.payload as never },
    });
  }

  it("reports Intercom and Linear, counts conversations as ingested, and completes with a tracker", async () => {
    const source = await connect("intercom");
    await seedConversation(source.id, "1");
    await seedConversation(source.id, "2");

    let status = await onboardingData.getOnboardingStatus(prisma, organizationId);
    expect(status.intercom).toEqual({ connected: true, backfillComplete: false, reauthRequired: false });
    expect(status.zendesk.connected).toBe(false);
    expect(status.ticketsFetched).toBe(2);
    expect(progress.deriveOnboardingProgress(status)).toMatchObject({ ticketSource: "intercom", complete: false });

    await prisma.integration.update({ where: { id: source.id }, data: { cursor: done } });
    status = await onboardingData.getOnboardingStatus(prisma, organizationId);
    expect(status.intercom.backfillComplete).toBe(true);
    expect(progress.deriveOnboardingProgress(status)).toMatchObject({ ticketSourceReady: true, tracker: null, complete: false });

    await connect("linear");
    status = await onboardingData.getOnboardingStatus(prisma, organizationId);
    expect(status.linear.connected).toBe(true);
    expect(progress.deriveOnboardingProgress(status)).toMatchObject({ tracker: "linear", complete: true });
  });

  it("projects an Intercom backfill into a case owned by that integration, deferring evaluation for a tracker still backfilling", async () => {
    const source = await connect("intercom", done);
    await seedConversation(source.id, "9001");
    await connect("linear"); // connected, first backfill outstanding

    const sync = await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);

    expect(sync.providers.zendesk).toBeUndefined();
    expect(sync.providers.intercom?.normalization.casesUpserted).toBe(1);
    expect(sync.providers.linear).toBeUndefined();
    expect(sync.pendingProviders).toEqual(["linear"]);
    expect(sync.evaluation).toBeNull();
    expect(await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "9001" } })).toMatchObject({
      system: "intercom",
      sourceIntegrationId: source.id,
    });
  });

  it("evaluates once the ticket source and the tracker have both finished", async () => {
    const source = await connect("intercom", done);
    await seedConversation(source.id, "9002");
    await connect("linear", done);

    const sync = await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);

    expect(sync.pendingProviders).toEqual([]);
    expect(sync.evaluation).not.toBeNull();
    expect(sync.providers.linear).toBeDefined();
  });

  it("waits for a ticket source when only a tracker is connected", async () => {
    await connect("linear", done);
    const sync = await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);
    expect(sync.pendingProviders).toEqual(["zendesk"]);
    expect(sync.evaluation).toBeNull();
  });
});
