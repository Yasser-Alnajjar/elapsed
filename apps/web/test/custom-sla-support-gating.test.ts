/**
 * D-08 row 4 (plan 09 §13): an unsupported commitment kind is excluded in the
 * shared commitments pipelines, not hidden in the UI, and providers with no
 * `slaSupport` keep today's behavior (Q1, D24).
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("SLA support gating in the shared pipelines (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");
  let organizationId: string;
  let customCaseId: string;
  let zendeskCaseId: string;
  let policyVersionId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    commitments = await import("@sla/commitments");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    organizationId = (await prisma.organization.create({ data: { name: "Gating Org" } })).id;
    const calendar = await prisma.businessCalendar.create({
      data: { organizationId, name: "24/7", versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } } },
      include: { versions: true },
    });
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "All" } });
    policyVersionId = (
      await prisma.sLAPolicyVersion.create({
        data: {
          policyId: policy.id,
          version: 1,
          match: {},
          targets: [
            { kind: "first_response", minutes: 120 },
            { kind: "next_reply", minutes: 60 },
            { kind: "resolution", minutes: 480 },
          ],
          pauseOnStates: [],
          calendarVersionId: calendar.versions[0]!.id,
          warnAtPercent: [80],
          effectiveFrom: at("00:00"),
        },
      })
    ).id;
    const custom = await prisma.integration.create({
      data: {
        organizationId,
        provider: "custom",
        credentials: {},
        slaSupport: { unsupportedKinds: ["first_response", "next_reply"], limitations: ["no_status_history"] },
      },
    });
    const zendesk = await prisma.integration.create({ data: { organizationId, provider: "zendesk", credentials: {} } });
    const mkCase = async (integrationId: string, system: "custom" | "zendesk") => {
      const row = await prisma.case.create({ data: { organizationId, system, sourceIntegrationId: integrationId, externalId: `${system}-1`, priority: "high", openedAt: at("10:00") } });
      const raw = await prisma.rawEvent.create({ data: { integrationId, providerEventId: `ticket:${system}`, sourceHash: "h", payload: {} } });
      await prisma.normalizedEvent.createMany({
        data: [
          { caseId: row.id, sourceRawEventId: raw.id, type: "case_created", occurredAt: at("10:00"), actor: "customer", system, sourceRole: "ticket_source", toState: "new" },
          { caseId: row.id, sourceRawEventId: raw.id, type: "agent_replied", occurredAt: at("10:30"), actor: "agent", system, sourceRole: "ticket_source" },
          { caseId: row.id, sourceRawEventId: raw.id, type: "customer_replied", occurredAt: at("11:00"), actor: "customer", system, sourceRole: "ticket_source" },
        ],
      });
      return row.id;
    };
    customCaseId = await mkCase(custom.id, "custom");
    zendeskCaseId = await mkCase(zendesk.id, "zendesk");
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const kinds = async (caseId: string) => (await prisma.commitment.findMany({ where: { caseId }, select: { kind: true } })).map((c) => c.kind).sort();

  it("creates no first_response or next_reply commitment for a source that cannot support them; a provider with no slaSupport keeps all", async () => {
    await commitments.runCommitmentPipeline(prisma, organizationId);
    await commitments.runNextReplyCyclePipeline(prisma, organizationId);
    expect(await kinds(customCaseId)).toEqual(["resolution"]);
    expect(await kinds(zendeskCaseId)).toEqual(expect.arrayContaining(["first_response", "resolution"]));
    expect((await kinds(zendeskCaseId)).length).toBeGreaterThan(2); // includes next_reply cycles
    expect(policyVersionId).toBeTruthy();
  });

  it("re-resolution never restores an excluded kind for the unsupported source", async () => {
    await commitments.runCommitmentPipeline(prisma, organizationId);
    await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf: at("12:00").toISOString() });
    await commitments.runCommitmentPipeline(prisma, organizationId);
    expect(await kinds(customCaseId)).toEqual(["resolution"]);
  });
  it("a cancelled first_response or resolution commitment is never recreated by the pipeline (R5)", async () => {
    await commitments.runCommitmentPipeline(prisma, organizationId);
    const row = await prisma.commitment.findFirstOrThrow({ where: { caseId: zendeskCaseId, kind: "first_response" } });
    await prisma.commitment.update({ where: { id: row.id }, data: { status: "cancelled" } });
    const before = await prisma.commitment.count({ where: { caseId: zendeskCaseId } });
    await commitments.runCommitmentPipeline(prisma, organizationId);
    await commitments.runCommitmentPipeline(prisma, organizationId);
    expect(await prisma.commitment.count({ where: { caseId: zendeskCaseId } })).toBe(before);
    expect((await prisma.commitment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("cancelled");
  });
});
