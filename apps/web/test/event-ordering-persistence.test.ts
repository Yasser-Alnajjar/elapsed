/**
 * Deterministic event ordering (SLA engine fix plan, step 1): the Zendesk
 * normalizer persists `sourceSequence` from the ticket's true audit order,
 * repeated normalization rewrites identical ordering, and the engine
 * evaluates the persisted rows identically however they are loaded.
 *
 * Real Postgres, like evaluation-persistence.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const AGENT = 900;
const REQUESTER = 501;
const CREATED_AT = "2026-09-17T09:00:00Z";
const SAME_SECOND = "2026-09-17T10:00:00Z";
const AS_OF = "2026-09-17T12:00:00.000Z";

describe.skipIf(!TEST_DATABASE_URL)("normalized event ordering (real Postgres)", () => {
  let prisma: PrismaClient;
  let zendesk: typeof import("@sla/zendesk");
  let commitments: typeof import("@sla/commitments");
  let core: typeof import("@sla/core");

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
    core = await import("@sla/core");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Ordering Org" } });
    const integration = await prisma.integration.create({
      data: { organizationId: organization.id, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    integrationId = integration.id;

    const comment = { id: 1, type: "Comment", public: true, body: "on it", author_id: AGENT };
    const status = (id: number, previous_value: string, value: string) => ({
      id,
      type: "Change",
      field_name: "status",
      previous_value,
      value,
    });
    const rawEvents: { providerEventId: string; payload: object }[] = [
      {
        providerEventId: "ticket:42",
        payload: {
          id: 42,
          subject: "Ordering",
          created_at: CREATED_AT,
          updated_at: SAME_SECOND,
          status: "open",
          priority: "normal",
          organization_id: null,
          requester_id: REQUESTER,
          via: { channel: "web" },
        },
      },
      { providerEventId: `user:${AGENT}`, payload: { id: AGENT, role: "agent" } },
      { providerEventId: `user:${REQUESTER}`, payload: { id: REQUESTER, role: "end-user" } },
      // Inserted out of audit order on purpose: the normalizer must not depend on load order.
      {
        providerEventId: "ticket_audit:102",
        payload: {
          id: 102,
          ticket_id: 42,
          created_at: SAME_SECOND,
          author_id: AGENT,
          via: { channel: "web" },
          events: [status(3, "pending", "open"), { ...comment, id: 4 }],
        },
      },
      {
        providerEventId: "ticket_audit:101",
        payload: {
          id: 101,
          ticket_id: 42,
          created_at: SAME_SECOND,
          author_id: AGENT,
          via: { channel: "web" },
          events: [{ ...comment, id: 1 }, status(2, "open", "pending")],
        },
      },
    ];
    for (const [i, raw] of rawEvents.entries()) {
      await prisma.rawEvent.create({
        data: { integrationId, providerEventId: raw.providerEventId, sourceHash: `hash-${i}`, payload: raw.payload },
      });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function loadPersisted() {
    const rows = await prisma.normalizedEvent.findMany({
      orderBy: [{ occurredAt: "asc" }, { sourceSequence: "asc" }],
      include: { sourceRawEvent: { select: { providerEventId: true } } },
    });
    return rows;
  }

  const describeRow = (row: Awaited<ReturnType<typeof loadPersisted>>[number]) =>
    `${row.sourceRawEvent.providerEventId}:${row.type}${row.toState ? `→${row.toState}` : ""}#${row.sourceSequence}`;

  it("persists a same-second audit's comment and status change in source audit order", async () => {
    await zendesk.runZendeskNormalization(prisma, integrationId);

    expect((await loadPersisted()).map(describeRow)).toEqual([
      "ticket_audit:101:case_created→open#0",
      "ticket_audit:101:agent_replied#1",
      "ticket_audit:101:state_changed→pending_customer#2",
      "ticket_audit:102:state_changed→open#3",
      "ticket_audit:102:agent_replied#4",
    ]);
  });

  it("is idempotent: renormalizing leaves the rows untouched, with identical ordering and sequences", async () => {
    await zendesk.runZendeskNormalization(prisma, integrationId);
    const first = await loadPersisted();
    await zendesk.runZendeskNormalization(prisma, integrationId);
    const second = await loadPersisted();

    // Reconciled against what's stored, not deleted and recreated: an
    // unchanged derivation keeps every row's id.
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(second.map(describeRow)).toEqual(first.map(describeRow));
  });

  it("evaluates persisted rows identically whatever order they are loaded in", async () => {
    await zendesk.runZendeskNormalization(prisma, integrationId);
    const rows = await loadPersisted();
    const caseId = rows[0]!.caseId;
    const commitment: import("@sla/core").Commitment = {
      id: "commitment-1",
      caseId,
      kind: "first_response",
      cycleKey: "single",
      policyVersionId: "policy-v1",
      calendarVersionId: "cal",
      startedAt: new Date(CREATED_AT).toISOString(),
      targetMinutes: 120,
      dueAt: "2026-09-17T11:00:00.000Z",
      status: "on_track",
    };
    const policy: import("@sla/core").SLAPolicyVersion = {
      id: "policy-v1",
      policyId: "policy",
      version: 1,
      match: {},
      targets: [{ kind: "first_response", minutes: 120 }],
      pauseOnStates: ["pending_customer"],
      calendarVersionId: "cal",
      warnAtPercent: [50, 80, 95],
      effectiveFrom: "2026-09-01T00:00:00.000Z",
    };
    const calendar: import("@sla/core").BusinessCalendarVersion = {
      id: "cal",
      version: 1,
      timezone: "UTC",
      weekly: [],
      holidays: [],
      alwaysOpen: true,
    };
    const evaluate = (ordered: typeof rows) =>
      core.evaluateCommitment(
        commitment,
        ordered.map((row) => commitments.toNormalizedEventDomain(row)),
        policy,
        calendar,
        AS_OF,
      );

    const baseline = evaluate(rows);
    expect(evaluate([...rows].reverse())).toEqual(baseline);
    expect(evaluate([...rows.slice(2), ...rows.slice(0, 2)])).toEqual(baseline);
    expect(baseline.inputs.lastEvent).toMatchObject({ type: "agent_replied", occurredAt: "2026-09-17T10:00:00.000Z" });
  });
});
