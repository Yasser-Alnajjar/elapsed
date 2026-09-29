/**
 * H-12 — Zendesk does not pause Resolution while a ticket is Pending, so a
 * Zendesk-imported policy must not either; a native policy keeps its default
 * Pending pause. The H-4 spot check found this on real dev-sandbox ticket 19
 * (target 20 min, two short Pending intervals): Zendesk's own `breach` event
 * was at exactly start + 20 min (11:37:45) while Elapsed said 11:38:29. The
 * ticket history below is that ticket's shape.
 *
 * Real Postgres, same shape as sla-golden-scenarios.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { Prisma, PrismaClient } from "@sla/db";
import type { ZendeskAudit, ZendeskTicket } from "@sla/zendesk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const SUBDOMAIN = "h12";
const at = (time: string) => new Date(`2026-09-21T${time}Z`);
const iso = (time: string) => at(time).toISOString();

describe.skipIf(!TEST_DATABASE_URL)("imported vs native policy on Pending (H-12, real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");
  let zendesk: typeof import("@sla/zendesk");
  let policies: typeof import("../../../packages/zendesk/src/policies");
  let organizationId: string;
  let integrationId: string;
  let calendar247Id: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    commitments = await import("@sla/commitments");
    zendesk = await import("@sla/zendesk");
    policies = await import("../../../packages/zendesk/src/policies");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    organizationId = (await prisma.organization.create({ data: { name: "H-12 Org" } })).id;
    integrationId = (
      await prisma.integration.create({
        data: { organizationId, provider: "zendesk", credentials: { subdomain: SUBDOMAIN } },
      })
    ).id;
    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    calendar247Id = calendar.versions[0]!.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  let nextAuditId = 1;
  const statusAudit = (ticketId: number, time: string, from: string, to: string): ZendeskAudit => {
    const id = nextAuditId++;
    return {
      id,
      ticket_id: ticketId,
      created_at: iso(time),
      author_id: 500,
      via: { channel: "web" },
      events: [{ id: id * 10, type: "Change", field_name: "status", previous_value: from, value: to }],
    };
  };
  const ticket = (id: number, priority: string): ZendeskTicket => ({
    id,
    url: `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/${id}.json`,
    external_id: null,
    subject: `Ticket ${id}`,
    created_at: iso("11:17:45"),
    updated_at: iso("11:56:47"),
    status: "solved",
    priority,
    organization_id: null,
    requester_id: 900,
    submitter_id: 900,
    via: { channel: "web" },
  });
  /** Ticket 19's history: two brief Pending intervals (34 s + 10 s), solved at 11:56:47. */
  const ticket19Audits = (id: number): ZendeskAudit[] => [
    statusAudit(id, "11:27:15", "open", "pending"),
    statusAudit(id, "11:27:49", "pending", "open"),
    statusAudit(id, "11:28:38", "open", "pending"),
    statusAudit(id, "11:28:48", "pending", "open"),
    statusAudit(id, "11:56:47", "open", "solved"),
  ];

  async function ingest(tickets: ZendeskTicket[], audits: ZendeskAudit[]) {
    const inputs = [...tickets.map((t) => zendesk.mapTicketToRawEvent(t)), ...audits.map(zendesk.mapAuditToRawEvent)];
    await prisma.rawEvent.createMany({
      data: inputs.map((i) => ({
        integrationId,
        providerEventId: i.providerEventId,
        sourceHash: i.sourceHash,
        payload: i.payload as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
    await zendesk.runZendeskNormalization(prisma, integrationId);
  }

  async function resolutionOf(externalId: string) {
    const c = await prisma.case.findUniqueOrThrow({ where: { organizationId_externalId: { organizationId, externalId } } });
    const row = await prisma.commitment.findFirstOrThrow({ where: { caseId: c.id, kind: "resolution" } });
    const evaluation = await prisma.evaluation.findFirstOrThrow({
      where: { commitmentId: row.id },
      orderBy: { evaluatedAt: "desc" },
    });
    return { row, evaluation };
  }

  async function runPipelines(asOf: string) {
    await commitments.runCommitmentPipeline(prisma, organizationId);
    await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf });
    await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf });
    await commitments.runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" });
  }

  it("imported policy: Pending never pauses Resolution; the breach lands exactly at start + target, as in Zendesk", async () => {
    await policies.upsertPolicyVersion(prisma, organizationId, "123:urgent", "Zendesk urgent", {
      match: { priority: ["urgent"] },
      targets: [{ kind: "resolution", minutes: 20 }],
      calendarVersionId: calendar247Id,
    });
    await ingest([ticket(19, "urgent")], ticket19Audits(19));
    await runPipelines(iso("12:00:00"));

    const { row, evaluation } = await resolutionOf("19");
    expect(row).toMatchObject({ targetMinutes: 20, status: "breached" });
    expect(row.dueAt).toEqual(at("11:37:45")); // Zendesk's breach event: 11:37:45
    expect(evaluation.breachedAt).toEqual(at("11:37:45")); // was 11:38:29 while Pending paused the clock
    expect(evaluation.elapsedSeconds).toBe(2342); // 11:17:45 -> 11:56:47, Zendesk's calendar elapsed
  });

  it("imported policy: the solved interval is still excluded after a reopen (D3 unchanged)", async () => {
    await policies.upsertPolicyVersion(prisma, organizationId, "123:high", "Zendesk high", {
      match: { priority: ["high"] },
      targets: [{ kind: "resolution", minutes: 240 }],
      calendarVersionId: calendar247Id,
    });
    await ingest(
      [{ ...ticket(20, "high"), status: "solved" }],
      [
        statusAudit(20, "11:27:15", "open", "solved"),
        statusAudit(20, "11:47:15", "solved", "open"), // 20 min solved
        statusAudit(20, "11:57:45", "open", "solved"),
      ],
    );
    await runPipelines(iso("12:00:00"));
    const { evaluation } = await resolutionOf("20");
    // 11:17:45 -> 11:57:45 = 40 min, minus the 20 min solved interval.
    expect(evaluation.elapsedSeconds).toBe(20 * 60);
  });

  it("native policy: keeps its default Pending pause", async () => {
    await commitments.createNativePolicy(prisma, organizationId, "Native high", {
      match: { priority: ["high"] },
      targets: [{ kind: "resolution", minutes: 20 }],
      warnAtPercent: [50, 80, 95],
    });
    await ingest([ticket(21, "high")], ticket19Audits(21));
    await runPipelines(iso("12:00:00"));

    const { evaluation } = await resolutionOf("21");
    expect(evaluation.elapsedSeconds).toBe(2342 - 44); // the 44 s of Pending is excluded
    expect(evaluation.breachedAt).toEqual(at("11:38:29"));
  });
});
