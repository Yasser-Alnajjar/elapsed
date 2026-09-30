/**
 * End-to-end coverage for "make Zendesk SLA policy conditions fully usable":
 * `extractMatchFromFilter` (packages/zendesk) already preserved every
 * condition field/operator generically, but a Case only ever carried a
 * handful of them (priority, tags as of the D6 fix, customerId via
 * organization_id). A policy conditioned on anything else — status, type,
 * group_id, assignee_id, channel, a custom field, ... — could never match
 * any ticket, silently. `zendeskConditionAttributes` (packages/zendesk/src/
 * normalize.ts) now resolves the rest onto `Case.attributes`, and this suite
 * exercises the full pipeline — raw ticket snapshot -> normalization ->
 * import -> commitment matching — for each of them.
 *
 * Real Postgres, like zendesk-ticket-tags.test.ts / zendesk-sla-policy-position.test.ts.
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Zendesk SLA condition field coverage (real Postgres)", () => {
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

    const organization = await prisma.organization.create({ data: { name: "Condition Fields Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    integrationId = integration.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function writePolicySnapshot(
    id: number,
    title: string,
    position: number | undefined,
    filter: { all?: { field: string; operator: string; value: string | number | null }[] } | undefined,
    metrics: { priority: string | null; metric: string; target: number; business_hours: boolean }[] = [
      { priority: null, metric: "first_reply_time", target: 60, business_hours: false },
    ],
  ) {
    const hash = `h-${id}-${position}`;
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: `sla_policy:${id}:${hash}`,
        sourceHash: hash,
        payload: { id, title, position, filter, policy_metrics: metrics },
      },
    });
  }

  function ticketRawEvent(overrides: Record<string, unknown>) {
    return {
      id: 2,
      subject: "Payment retries failing",
      created_at: "2026-09-01T09:00:00Z",
      updated_at: "2026-09-01T09:00:00Z",
      status: "open",
      priority: "normal",
      organization_id: null,
      requester_id: 501,
      via: { channel: "web" },
      ...overrides,
    };
  }

  async function seedTicket(payload: object, hash = "hash-1") {
    const id = (payload as { id: number }).id;
    await prisma.rawEvent.create({
      data: { integrationId, providerEventId: `ticket:${id}:${hash}`, sourceHash: hash, payload },
    });
  }

  async function importAndMatch() {
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    await zendesk.runZendeskNormalization(prisma, integrationId);
    await commitments.runCommitmentPipeline(prisma, organizationId);
  }

  async function winningPolicyNameFor(externalTicketId: string) {
    const zCase = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: externalTicketId } });
    const created = await prisma.commitment.findFirstOrThrow({ where: { caseId: zCase.id } });
    const matchedPolicy = await prisma.sLAPolicy.findFirstOrThrow({
      where: { versions: { some: { id: created.policyVersionId } } },
    });
    return matchedPolicy.name;
  }

  describe("individual condition fields resolve onto Case.attributes and can match", () => {
    it("status", async () => {
      await writePolicySnapshot(1, "Pending status", 1, { all: [{ field: "status", operator: "is", value: "pending" }] });
      await seedTicket(ticketRawEvent({ status: "pending" }));
      await importAndMatch();
      expect(await winningPolicyNameFor("2")).toBe("Pending status");
    });

    it("type", async () => {
      await writePolicySnapshot(1, "Incident type", 1, { all: [{ field: "type", operator: "is", value: "incident" }] });
      await seedTicket(ticketRawEvent({ type: "incident" }));
      await importAndMatch();
      expect(await winningPolicyNameFor("2")).toBe("Incident type");
    });

    it("group_id", async () => {
      await writePolicySnapshot(1, "Group 42", 1, { all: [{ field: "group_id", operator: "is", value: 42 }] });
      await seedTicket(ticketRawEvent({ group_id: 42 }));
      await importAndMatch();
      expect(await winningPolicyNameFor("2")).toBe("Group 42");
    });

    it("assignee_id", async () => {
      await writePolicySnapshot(1, "Assignee 7", 1, { all: [{ field: "assignee_id", operator: "is", value: 7 }] });
      await seedTicket(ticketRawEvent({ assignee_id: 7 }));
      await importAndMatch();
      expect(await winningPolicyNameFor("2")).toBe("Assignee 7");
    });

    it("requester_id", async () => {
      await writePolicySnapshot(1, "Requester 501", 1, { all: [{ field: "requester_id", operator: "is", value: 501 }] });
      await seedTicket(ticketRawEvent({ requester_id: 501 }));
      await importAndMatch();
      expect(await winningPolicyNameFor("2")).toBe("Requester 501");
    });

    it("channel / via_id", async () => {
      await writePolicySnapshot(1, "Chat channel", 1, { all: [{ field: "via_id", operator: "is", value: "chat" }] });
      await seedTicket(ticketRawEvent({ via: { channel: "chat" } }));
      await importAndMatch();
      expect(await winningPolicyNameFor("2")).toBe("Chat channel");
    });

    it("custom_fields_<id>", async () => {
      await writePolicySnapshot(1, "Gold tier custom field", 1, {
        all: [{ field: "custom_fields_360000123", operator: "is", value: "gold" }],
      });
      await seedTicket(ticketRawEvent({ custom_fields: [{ id: 360000123, value: "gold" }] }));
      await importAndMatch();
      expect(await winningPolicyNameFor("2")).toBe("Gold tier custom field");
    });

    it("current_tags (alias of tags)", async () => {
      await writePolicySnapshot(1, "Current tags alias", 1, {
        all: [{ field: "current_tags", operator: "includes", value: "escalated" }],
      });
      await seedTicket(ticketRawEvent({ tags: ["escalated"] }));
      await importAndMatch();
      expect(await winningPolicyNameFor("2")).toBe("Current tags alias");
    });

    it("a condition field with no known Case representation fails safe (never matches)", async () => {
      await writePolicySnapshot(1, "Custom status gate", 1, {
        all: [{ field: "custom_status_id", operator: "is", value: 1 }],
      });
      await writePolicySnapshot(2, "Catch-all", 2, undefined);
      await seedTicket(ticketRawEvent({}));
      await importAndMatch();
      expect(await winningPolicyNameFor("2")).toBe("Catch-all");
    });
  });

  it("missing attributes on the ticket cause the conditioned policy to lose to a lower-priority catch-all only when position says so", async () => {
    await writePolicySnapshot(1, "Requires custom field", 1, {
      all: [{ field: "custom_fields_1", operator: "present", value: null }],
    });
    await writePolicySnapshot(2, "Catch-all", 2, undefined);
    await seedTicket(ticketRawEvent({}));
    await importAndMatch();
    expect(await winningPolicyNameFor("2")).toBe("Catch-all");
  });

  it("multiple matching policies: the more specific (canonical) match wins when neither carries a Zendesk position", async () => {
    await writePolicySnapshot(1, "Catch-all", undefined, undefined);
    await writePolicySnapshot(2, "Urgent only", undefined, {
      all: [{ field: "priority", operator: "is", value: "urgent" }],
    });
    await seedTicket(ticketRawEvent({ priority: "urgent" }));
    await importAndMatch();
    expect(await winningPolicyNameFor("2")).toBe("Urgent only");
  });

  it("combinations of conditions (all + any across multiple resolved fields)", async () => {
    await writePolicySnapshot(1, "VIP escalation", 1, {
      all: [
        { field: "group_id", operator: "is", value: 42 },
        { field: "current_tags", operator: "includes", value: "vip" },
      ],
    });
    await seedTicket(ticketRawEvent({ group_id: 42, tags: ["vip"] }));
    await importAndMatch();
    expect(await winningPolicyNameFor("2")).toBe("VIP escalation");

    await prisma.commitment.deleteMany({});
    await prisma.case.deleteMany({});
    await seedTicket(ticketRawEvent({ group_id: 99, tags: ["vip"] }), "hash-2");
    await zendesk.runZendeskNormalization(prisma, integrationId);
    await commitments.runCommitmentPipeline(prisma, organizationId);
    const noMatchCase = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "2" } });
    expect(await prisma.commitment.findFirst({ where: { caseId: noMatchCase.id } })).toBeNull();
  });

  /**
   * The exact reported real-world scenario (requirement #10): Zendesk
   * ticket #2, organization "D6 Test Company", tagged "d6", priority
   * "normal", with three candidate policies at positions 1-3. The
   * tag-filtered policy at position 1 must win over the organization-
   * filtered policy at position 2 and the unfiltered catch-all at position
   * 3 — D6's position-before-specificity rule, now exercised together with
   * the tags fix this same pipeline depends on.
   */
  it("D6 regression: ticket #2 (D6 Test Company, tag 'd6', normal priority) matches 'D6-Org Ticket Tag - d6' at 18m/26m", async () => {
    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name: "D6 Test Company",
        zendeskOrgId: "555",
        identities: { create: { organizationId, provider: "zendesk", kind: "organization", externalId: "555" } },
      },
    });

    await writePolicySnapshot(
      1,
      "D6-Org Ticket Tag - d6",
      1,
      { all: [{ field: "tags", operator: "contains", value: "d6" }] },
      [
        { priority: null, metric: "first_reply_time", target: 18, business_hours: false },
        { priority: null, metric: "total_resolution_time", target: 26, business_hours: false },
      ],
    );
    await writePolicySnapshot(
      2,
      "D6 - Organization Policy",
      2,
      { all: [{ field: "organization_id", operator: "is", value: "555" }] },
      [
        { priority: null, metric: "first_reply_time", target: 8, business_hours: false },
        { priority: null, metric: "total_resolution_time", target: 12, business_hours: false },
      ],
    );
    await writePolicySnapshot(
      3,
      "Set first reply time",
      3,
      undefined,
      [
        { priority: null, metric: "first_reply_time", target: 90, business_hours: false },
        { priority: null, metric: "total_resolution_time", target: 60, business_hours: false },
      ],
    );

    await seedTicket(
      ticketRawEvent({
        id: 2,
        organization_id: 555,
        tags: ["d6"],
        priority: "normal",
      }),
    );

    await importAndMatch();

    const zCase = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "2" } });
    expect(zCase.customerId).toBe(customer.id);

    expect(await winningPolicyNameFor("2")).toBe("D6-Org Ticket Tag - d6");

    const firstResponse = await prisma.commitment.findFirstOrThrow({
      where: { caseId: zCase.id, kind: "first_response" },
    });
    const resolution = await prisma.commitment.findFirstOrThrow({
      where: { caseId: zCase.id, kind: "resolution" },
    });
    expect(firstResponse.targetMinutes).toBe(18);
    expect(resolution.targetMinutes).toBe(26);
  });
});
