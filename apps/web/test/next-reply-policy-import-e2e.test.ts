/**
 * Step 8 end-to-end: a Zendesk `next_reply_time` metric survives the whole
 * chain — imported as a `next_reply` policy target, persisted onto an
 * `SLAPolicyVersion`, and frozen onto a `next_reply` Commitment when
 * `runNextReplyCyclePipeline` derives a cycle for it. Deliberately stops at
 * commitment creation: evaluating that commitment (`runEvaluationPipeline`,
 * Step 9) is next-reply-commitment-persistence.test.ts's concern, not this
 * suite's.
 *
 * Real Postgres, like next-reply-cycle-pipeline.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when
 * unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("Zendesk next_reply_time -> frozen Commitment target (real Postgres)", () => {
  let prisma: PrismaClient;
  let zendesk: typeof import("@sla/zendesk");
  let commitments: typeof import("@sla/commitments");
  // The Zendesk importer no longer depends on @sla/commitments (N1.12): the caller supplies the default calendar.
  const ensureDefaultCalendar = (organizationId: string) =>
    commitments.ensureDefaultCalendarVersion(prisma, organizationId);

  let organizationId: string;
  let integrationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    // @sla/db builds its connection from DATABASE_URL at import time.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    zendesk = await import("@sla/zendesk");
    commitments = await import("@sla/commitments");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Next Reply Import Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    integrationId = integration.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("imports next_reply_time, persists it on the policy version, and freezes it onto a Next Reply Commitment", async () => {
    // 1. A Zendesk SLA policy snapshot whose policy_metrics include
    // next_reply_time alongside first_reply_time and total_resolution_time.
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "sla_policy:501",
        sourceHash: "h1",
        payload: {
          id: 501,
          title: "Standard",
          policy_metrics: [
            { priority: null, metric: "first_reply_time", target: 120, business_hours: true },
            { priority: null, metric: "total_resolution_time", target: 1440, business_hours: true },
            { priority: null, metric: "next_reply_time", target: 30, business_hours: true },
          ],
        },
      },
    });

    const importResult = await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    expect(importResult.unsupportedMetrics).toBe(0);
    expect(importResult.policyVersionsCreated).toBe(1);

    // 2. The imported target lands on the persisted SLAPolicyVersion.
    const policyVersion = await prisma.sLAPolicyVersion.findFirstOrThrow({
      where: { policy: { organizationId } },
    });
    expect(policyVersion.source).toBe("imported");
    expect(policyVersion.targets).toEqual(
      expect.arrayContaining([{ kind: "next_reply", minutes: 30 }]),
    );

    // 3. A case with a completed first response and one open customer reply,
    // anchored to the imported policy/calendar version — the same shape
    // runCommitmentPipeline would have created the anchor commitment as.
    const caseRow = await prisma.case.create({
      data: { organizationId, system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), externalId: "case-1", openedAt: at("09:00") },
    });
    const rawTicketEvent = await prisma.rawEvent.create({
      data: { integrationId, providerEventId: "ticket:1", sourceHash: "h2", payload: { id: 1 } },
    });
    await prisma.normalizedEvent.createMany({
      data: [
        { caseId: caseRow.id, sourceRawEventId: rawTicketEvent.id, type: "case_created", occurredAt: at("09:00"), actor: "customer", system: "zendesk", sourceRole: "ticket_source", sourceSequence: 0 },
        { caseId: caseRow.id, sourceRawEventId: rawTicketEvent.id, type: "agent_replied", occurredAt: at("09:30"), actor: "agent", system: "zendesk", sourceRole: "ticket_source", sourceSequence: 1 },
        { caseId: caseRow.id, sourceRawEventId: rawTicketEvent.id, type: "customer_replied", occurredAt: at("10:00"), actor: "customer", system: "zendesk", sourceRole: "ticket_source", sourceSequence: 2 },
      ],
    });
    await prisma.commitment.create({
      data: {
        caseId: caseRow.id,
        kind: "first_response",
        policyVersionId: policyVersion.id,
        calendarVersionId: policyVersion.calendarVersionId,
        startedAt: at("09:00"),
        targetMinutes: 120,
        dueAt: at("11:00"),
      },
    });

    // 4. Deriving and persisting the case's Next Reply cycles freezes the
    // imported next_reply target onto the new Commitment.
    const cycleResult = await commitments.runNextReplyCyclePipeline(prisma, organizationId, {
      asOf: at("10:30").toISOString(),
    });
    expect(cycleResult.casesFailed).toEqual([]);
    expect(cycleResult.cyclesCreated).toBe(1);

    const nextReplyCommitment = await prisma.commitment.findFirstOrThrow({
      where: { caseId: caseRow.id, kind: "next_reply" },
    });
    expect(nextReplyCommitment).toMatchObject({
      policyVersionId: policyVersion.id,
      calendarVersionId: policyVersion.calendarVersionId,
      targetMinutes: 30,
      startedAt: at("10:00"),
      status: "on_track",
    });
  });
});
