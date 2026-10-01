/**
 * Ticket #45 regression (Cases E and F): what the evaluation pipeline
 * persists must keep exact SLA timing and stay explainable after the
 * normalizer regenerates the case's NormalizedEvent rows. Exercised on a
 * resolution commitment, which pauses on Pending — first response never
 * pauses (clock-rules.ts in @sla/core).
 *
 * Real Postgres, like tenant-isolation.test.ts: the precision bug lived in
 * the column type, which a fake Prisma can't reproduce. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const OPENED = new Date("2026-09-17T09:19:30.000Z");
const PAUSED = new Date("2026-09-17T09:20:04.000Z");
const AS_OF = "2026-09-17T09:23:00.000Z";
const AUDIT_PROVIDER_EVENT_ID = "ticket_audit:39016977009682";

describe.skipIf(!TEST_DATABASE_URL)("evaluation persistence (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");
  let core: typeof import("@sla/core");

  let organizationId: string;
  let caseId: string;
  let auditRawEventId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    // @sla/db builds its connection from DATABASE_URL at import time.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    commitments = await import("@sla/commitments");
    core = await import("@sla/core");
  });

  /** Writes the case's events the way the Zendesk normalizer does: delete its own rows, re-create them. */
  async function normalize() {
    await prisma.$transaction([
      prisma.normalizedEvent.deleteMany({ where: { caseId, sourceRawEventId: { in: [auditRawEventId] } } }),
      prisma.normalizedEvent.createMany({
        data: [
          { caseId, sourceRawEventId: auditRawEventId, type: "case_created", occurredAt: OPENED, actor: "customer", system: "zendesk", sourceRole: "ticket_source", toState: "open" },
          { caseId, sourceRawEventId: auditRawEventId, type: "state_changed", occurredAt: PAUSED, actor: "customer", system: "zendesk", sourceRole: "ticket_source", fromState: "open", toState: "pending_customer" },
        ],
      }),
    ]);
  }

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Ticket 45 Org" } });
    organizationId = organization.id;
    const zendesk = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    const audit = await prisma.rawEvent.create({
      data: {
        integrationId: zendesk.id,
        providerEventId: AUDIT_PROVIDER_EVENT_ID,
        sourceHash: "audit-hash",
        payload: { ticket_id: 45, events: [{ field_name: "status", previous_value: "open", value: "pending" }] },
      },
    });
    auditRawEventId = audit.id;

    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const calendarVersionId = calendar.versions[0]!.id;
    const policy = await prisma.sLAPolicy.create({
      data: {
        organizationId,
        name: "Urgent",
        versions: {
          create: {
            version: 6,
            match: { priority: ["urgent"] },
            targets: [{ kind: "resolution", minutes: 2 }],
            pauseOnStates: ["pending_customer"],
            calendarVersionId,
            warnAtPercent: [50, 80, 95],
            effectiveFrom: new Date("2026-09-17T09:14:41.625Z"),
          },
        },
      },
      include: { versions: true },
    });

    const caseRow = await prisma.case.create({
      data: { organizationId, system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), externalId: "45", priority: "urgent", openedAt: OPENED },
    });
    caseId = caseRow.id;
    await normalize();
    await prisma.commitment.create({
      data: {
        caseId,
        kind: "resolution",
        policyVersionId: policy.versions[0]!.id,
        calendarVersionId,
        startedAt: OPENED,
        targetMinutes: 2,
        dueAt: new Date(OPENED.getTime() + 2 * 60_000),
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("Case E: 86 seconds remaining is still 86 seconds after persistence and reload", async () => {
    const result = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: AS_OF });
    expect(result.evaluationsCreated).toBe(1);

    const [reloaded] = await prisma.evaluation.findMany({ where: { commitment: { caseId } } });
    expect(reloaded).toMatchObject({
      status: "on_track",
      elapsedSeconds: 34,
      remainingSeconds: 86,
      breachedBySeconds: null,
    });
    expect(reloaded!.evaluatedAt.toISOString()).toBe(AS_OF);
  });

  it("Case F: after the events are regenerated, the Evaluation still identifies its source event", async () => {
    await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: AS_OF });
    const [evaluation] = await prisma.evaluation.findMany({ where: { commitment: { caseId } } });
    const idsBefore = (await prisma.normalizedEvent.findMany({ where: { caseId } })).map((e) => e.id).sort();

    await normalize();

    const regenerated = await prisma.normalizedEvent.findMany({ where: { caseId } });
    expect(regenerated.map((e) => e.id).sort()).not.toEqual(idsBefore);

    const lastEvent = (evaluation!.inputs as { lastEvent: Record<string, string | null> }).lastEvent;
    expect(lastEvent).toEqual({
      sourceRawEventId: auditRawEventId,
      providerEventId: AUDIT_PROVIDER_EVENT_ID,
      system: "zendesk",
      type: "state_changed",
      occurredAt: PAUSED.toISOString(),
      toState: "pending_customer",
    });

    // It resolves to the immutable raw audit...
    const raw = await prisma.rawEvent.findUniqueOrThrow({ where: { id: lastEvent.sourceRawEventId! } });
    expect(raw.providerEventId).toBe(AUDIT_PROVIDER_EVENT_ID);
    // ...and to exactly one of the regenerated normalized events.
    const matches = regenerated.filter(
      (e) =>
        e.sourceRawEventId === lastEvent.sourceRawEventId &&
        e.type === lastEvent.type &&
        e.occurredAt.toISOString() === lastEvent.occurredAt &&
        e.toState === lastEvent.toState,
    );
    expect(matches).toHaveLength(1);

    // Re-deriving from the regenerated events reproduces the persisted snapshot, id included.
    const row = await prisma.commitment.findFirstOrThrow({ where: { caseId } });
    const policyVersion = await prisma.sLAPolicyVersion.findUniqueOrThrow({ where: { id: row.policyVersionId } });
    const calendar = await prisma.businessCalendarVersion.findUniqueOrThrow({ where: { id: row.calendarVersionId } });
    const replay = core.evaluateCommitment(
      commitments.toCommitmentDomain(row),
      regenerated.map(commitments.toNormalizedEventDomain),
      {
        ...policyVersion,
        match: policyVersion.match as never,
        targets: policyVersion.targets as never,
        pauseOnStates: policyVersion.pauseOnStates as never,
        effectiveFrom: policyVersion.effectiveFrom.toISOString(),
      },
      { ...calendar, weekly: calendar.weekly as never },
      AS_OF,
    );
    expect(replay.id).toBe(evaluation!.id);
    expect(replay).toMatchObject({ elapsedSeconds: evaluation!.elapsedSeconds, remainingSeconds: evaluation!.remainingSeconds });
  });
});
