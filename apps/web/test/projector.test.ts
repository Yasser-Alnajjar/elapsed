/**
 * N2.2 — the shared projector. Real Postgres, like the other persistence
 * suites. Needs a migrated database at TEST_DATABASE_URL whose name contains
 * "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import type { CanonicalBatch, EventGroup, IntegrationRef, LinkFact, LinkSweep, NormalizedEventFact } from "@sla/ingestion";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("projectCanonicalBatch (real Postgres)", () => {
  let prisma: PrismaClient;
  let projectCanonicalBatch: typeof import("@sla/ingestion").projectCanonicalBatch;
  let projectLinkFacts: typeof import("@sla/ingestion").projectLinkFacts;
  let projectLinkSweep: typeof import("@sla/ingestion").projectLinkSweep;
  let projectIssueRemoval: typeof import("@sla/ingestion").projectIssueRemoval;

  let organizationId: string;
  let zendesk: IntegrationRef;
  let intercom: IntegrationRef;
  let jira: IntegrationRef;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    ({ projectCanonicalBatch, projectLinkFacts, projectLinkSweep, projectIssueRemoval } = await import("@sla/ingestion"));
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);

    organizationId = (await prisma.organization.create({ data: { name: "Projector Org" } })).id;
    const integrationFor = async (provider: "zendesk" | "intercom" | "jira"): Promise<IntegrationRef> => {
      const row = await prisma.integration.create({ data: { organizationId, provider, credentials: {} } });
      return { id: row.id, organizationId, provider, status: row.status };
    };
    zendesk = await integrationFor("zendesk");
    intercom = await integrationFor("intercom");
    jira = await integrationFor("jira");
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function rawEvent(integration: IntegrationRef, key: string): Promise<string> {
    const row = await prisma.rawEvent.create({
      data: { integrationId: integration.id, providerEventId: key, sourceHash: key, payload: {} },
    });
    return row.id;
  }

  const event = (rawEventId: string, overrides: Partial<NormalizedEventFact> = {}): NormalizedEventFact => ({
    type: "case_created",
    occurredAt: new Date("2026-09-01T09:00:00Z"),
    actor: "customer",
    sourceRole: "ticket_source",
    fromState: null,
    toState: "open",
    sourceRawEventId: rawEventId,
    sourceSequence: 0,
    ...overrides,
  });

  const ticketCase = (externalId: string, overrides: Record<string, unknown> = {}) => ({
    externalId,
    subject: "Cannot log in",
    requesterName: "Ahmed",
    assigneeName: null,
    priority: null,
    tier: null,
    channel: "web",
    tags: ["vip"],
    attributes: { status: "open" },
    openedAt: new Date("2026-09-01T09:00:00Z"),
    closedAt: null,
    customer: null,
    ...overrides,
  });

  const batch = (overrides: Partial<CanonicalBatch> = {}): CanonicalBatch => ({
    customers: [],
    cases: [],
    eventGroups: [],
    deletedCaseExternalIds: [],
    failures: [],
    ...overrides,
  });

  const group = (caseExternalId: string, rawEventIds: string[], events: NormalizedEventFact[]): EventGroup => ({
    target: { caseExternalId },
    ownRawEventIds: rawEventIds,
    events,
    recordId: caseExternalId,
  });

  it("creates the customer, the case and its events, owned by the integration", async () => {
    const raw = await rawEvent(zendesk, "ticket:1:h");
    const result = await projectCanonicalBatch(
      prisma,
      zendesk,
      batch({
        customers: [{ provider: "zendesk", kind: "organization", externalId: "900", name: "Acme" }],
        cases: [ticketCase("1", { customer: { provider: "zendesk", kind: "organization", externalId: "900" } })],
        eventGroups: [group("1", [raw], [event(raw)])],
      }),
    );

    expect(result).toMatchObject({ customersUpserted: 1, casesUpserted: 1, eventsDerived: 1, eventsCreated: 1, failures: [] });
    const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" }, include: { customer: { include: { identities: true } } } });
    expect(caseRow).toMatchObject({
      system: "zendesk",
      sourceIntegrationId: zendesk.id,
      subject: "Cannot log in",
      requesterName: "Ahmed",
      tags: ["vip"],
      attributes: { status: "open" },
      customer: { name: "Acme", identities: [{ provider: "zendesk", kind: "organization", externalId: "900" }] },
    });
    const events = await prisma.normalizedEvent.findMany({ where: { caseId: caseRow.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ system: "zendesk", sourceRole: "ticket_source", type: "case_created", toState: "open" });
    const identity = await prisma.customerIdentity.findFirstOrThrow({ where: { organizationId } });
    expect(identity).toMatchObject({ provider: "zendesk", kind: "organization", externalId: "900" });
  });

  it("writes nothing when the same batch is projected again", async () => {
    const raw = await rawEvent(zendesk, "ticket:1:h");
    const input = batch({ cases: [ticketCase("1")], eventGroups: [group("1", [raw], [event(raw)])] });
    await projectCanonicalBatch(prisma, zendesk, input);
    const before = await prisma.normalizedEvent.findMany();

    const result = await projectCanonicalBatch(prisma, zendesk, input);

    expect(result).toMatchObject({ eventsDerived: 1, eventsCreated: 0, eventsDeleted: 0 });
    expect(await prisma.normalizedEvent.findMany()).toEqual(before);
  });

  it("writes only the difference when an event changes, keeping unchanged events' ids and createdAt", async () => {
    const raw = await rawEvent(zendesk, "ticket:1:h");
    const kept = event(raw);
    const replaced = event(raw, { type: "state_changed", sourceSequence: 1, toState: "pending_customer", occurredAt: new Date("2026-09-01T10:00:00Z") });
    await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1")], eventGroups: [group("1", [raw], [kept, replaced])] }));
    const [first] = await prisma.normalizedEvent.findMany({ where: { sourceSequence: 0 } });

    const changed = { ...replaced, toState: "resolved" as const };
    const result = await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1")], eventGroups: [group("1", [raw], [kept, changed])] }));

    expect(result).toMatchObject({ eventsCreated: 1, eventsDeleted: 1 });
    const stored = await prisma.normalizedEvent.findMany({ orderBy: { sourceSequence: "asc" } });
    expect(stored.map((e) => e.toState)).toEqual(["open", "resolved"]);
    expect(stored[0]).toMatchObject({ id: first!.id, createdAt: first!.createdAt });
  });

  it("never touches events another provider wrote onto the same case", async () => {
    const raw = await rawEvent(zendesk, "ticket:1:h");
    await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1")], eventGroups: [group("1", [raw], [event(raw)])] }));
    const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" } });
    const jiraRaw = await rawEvent(jira, "issue:ENG-1:h");
    await prisma.normalizedEvent.create({
      data: { caseId: caseRow.id, sourceRawEventId: jiraRaw, type: "state_changed", occurredAt: new Date("2026-09-01T11:00:00Z"), actor: "agent", system: "jira", sourceRole: "work_tracker", toState: "in_progress" },
    });

    await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1")], eventGroups: [group("1", [raw], [])] }));

    const remaining = await prisma.normalizedEvent.findMany({ where: { caseId: caseRow.id } });
    expect(remaining.map((e) => e.system)).toEqual(["jira"]);
  });

  it("keeps the same external id in two organizations as two cases", async () => {
    const other = await prisma.organization.create({ data: { name: "Other Org" } });
    const row = await prisma.integration.create({ data: { organizationId: other.id, provider: "zendesk", credentials: {} } });
    const otherZendesk: IntegrationRef = { id: row.id, organizationId: other.id, provider: "zendesk", status: row.status };

    await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("77", { subject: "Ours" })] }));
    await projectCanonicalBatch(prisma, otherZendesk, batch({ cases: [ticketCase("77", { subject: "Theirs" })] }));

    const cases = await prisma.case.findMany({ where: { externalId: "77" }, orderBy: { subject: "asc" } });
    expect(cases.map((c) => [c.organizationId, c.subject])).toEqual([
      [organizationId, "Ours"],
      [other.id, "Theirs"],
    ]);
  });

  // Two sources reusing one id inside an organization needs N2.10: until the
  // `(organizationId, externalId)` key is dropped it collides, and the
  // projector reports the loser as a failure instead of writing it.

  it("updates a case in place without moving its opening time or system", async () => {
    await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1")] }));
    await projectCanonicalBatch(
      prisma,
      zendesk,
      batch({ cases: [ticketCase("1", { subject: "Renamed", openedAt: new Date("2027-01-01T00:00:00Z"), closedAt: new Date("2026-09-02T00:00:00Z") })] }),
    );

    const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" } });
    expect(caseRow).toMatchObject({ subject: "Renamed", system: "zendesk" });
    expect(caseRow.openedAt).toEqual(new Date("2026-09-01T09:00:00Z"));
    expect(caseRow.closedAt).toEqual(new Date("2026-09-02T00:00:00Z"));
  });

  it("leaves the customer empty for an identity it does not know, and clears a removed one", async () => {
    const unknown = { provider: "zendesk" as const, kind: "organization", externalId: "404" };
    await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1", { customer: unknown })] }));
    expect((await prisma.case.findFirstOrThrow({ where: { externalId: "1" } })).customerId).toBeNull();

    const known = { provider: "zendesk" as const, kind: "organization", externalId: "900" };
    await projectCanonicalBatch(prisma, zendesk, batch({ customers: [{ ...known, name: "Acme" }], cases: [ticketCase("1", { customer: known })] }));
    expect((await prisma.case.findFirstOrThrow({ where: { externalId: "1" } })).customerId).not.toBeNull();

    await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1")] }));
    expect((await prisma.case.findFirstOrThrow({ where: { externalId: "1" } })).customerId).toBeNull();
  });

  it("names a customer by its identity rows: a company and a contact are two customers", async () => {
    await projectCanonicalBatch(
      prisma,
      intercom,
      batch({
        customers: [
          { provider: "intercom", kind: "company", externalId: "c1", name: "Company" },
          { provider: "intercom", kind: "contact", externalId: "p1", name: "Person" },
        ],
      }),
    );
    const customers = await prisma.customer.findMany({ orderBy: { name: "asc" }, include: { identities: true } });
    expect(customers.map((c) => [c.name, c.identities.map((i) => [i.provider, i.kind, i.externalId])])).toEqual([
      ["Company", [["intercom", "company", "c1"]]],
      ["Person", [["intercom", "contact", "p1"]]],
    ]);
  });

  it("soft-deletes cases the source dropped, once, and an upsert never clears it", async () => {
    await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1"), ticketCase("2")] }));

    const first = await projectCanonicalBatch(prisma, zendesk, batch({ deletedCaseExternalIds: ["1", "9"] }));
    const deletedAt = (await prisma.case.findFirstOrThrow({ where: { externalId: "1" } })).deletedAt;
    const second = await projectCanonicalBatch(prisma, zendesk, batch({ deletedCaseExternalIds: ["1"] }));

    expect(first.casesDeleted).toBe(1);
    expect(second.casesDeleted).toBe(0);
    expect(deletedAt).not.toBeNull();
    expect((await prisma.case.findFirstOrThrow({ where: { externalId: "2" } })).deletedAt).toBeNull();

    await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1")] }));
    expect((await prisma.case.findFirstOrThrow({ where: { externalId: "1" } })).deletedAt).toEqual(deletedAt);
  });

  it("reports a record that fails and still projects the rest", async () => {
    const raw = await rawEvent(zendesk, "ticket:2:h");
    const result = await projectCanonicalBatch(
      prisma,
      zendesk,
      batch({
        cases: [ticketCase("2")],
        eventGroups: [group("missing", [raw], [event(raw)]), group("2", [raw], [event(raw)])],
        failures: [{ id: "adapter-failed", error: "Unknown status" }],
      }),
    );

    expect(result.failures).toEqual([
      { id: "adapter-failed", error: "Unknown status" },
      { id: "missing", error: "No case missing to attach events to" },
    ]);
    expect(await prisma.normalizedEvent.count()).toBe(1);
  });

  it("projects a tracker's events onto the case a link names and merges link evidence", async () => {
    const caseRow = await prisma.case.create({
      data: { organizationId, externalId: "1", system: "zendesk", sourceIntegrationId: zendesk.id, openedAt: new Date("2026-09-01T09:00:00Z") },
    });
    await prisma.caseLink.create({
      data: { caseId: caseRow.id, system: "jira", externalId: "ENG-1", method: "remote_link", confidence: "certain", evidence: { remoteLink: { id: 5 } } },
    });
    const raw = await rawEvent(jira, "issue:ENG-1:h");
    const trackerGroup: EventGroup = {
      target: { caseId: caseRow.id },
      ownRawEventIds: [raw],
      events: [event(raw, { type: "state_changed", actor: "agent", sourceRole: "work_tracker", toState: "in_progress" })],
      linkEvidencePatch: { externalId: "ENG-1", patch: { statusName: "In Progress" } },
      recordId: "ENG-1",
    };

    await projectCanonicalBatch(prisma, jira, batch({ eventGroups: [trackerGroup] }));
    await projectCanonicalBatch(prisma, jira, batch({ eventGroups: [trackerGroup] }));

    const events = await prisma.normalizedEvent.findMany({ where: { caseId: caseRow.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ system: "jira", sourceRole: "work_tracker", toState: "in_progress" });
    const link = await prisma.caseLink.findFirstOrThrow({ where: { caseId: caseRow.id } });
    expect(link.evidence).toEqual({ remoteLink: { id: 5 }, statusName: "In Progress" });
  });

  describe("change detection (D32)", () => {
    const known = { provider: "zendesk" as const, kind: "organization", externalId: "900" };
    const withCustomer = (name = "Acme") =>
      batch({ customers: [{ ...known, name }], cases: [ticketCase("1", { customer: known, assigneeName: "Ada", priority: "high" })] });

    it("counts a new customer and a new case as changes", async () => {
      expect(await projectCanonicalBatch(prisma, zendesk, withCustomer())).toMatchObject({ customersChanged: 1, casesChanged: 1, casesUpserted: 1 });
    });

    it("reports no change when the same batch is projected again, although every case is still processed", async () => {
      await projectCanonicalBatch(prisma, zendesk, withCustomer());
      const again = await projectCanonicalBatch(prisma, zendesk, withCustomer());
      expect(again).toMatchObject({ customersUpserted: 1, customersChanged: 0, casesUpserted: 1, casesChanged: 0, eventsCreated: 0, eventsDeleted: 0, casesDeleted: 0 });
    });

    it.each([
      ["assignee", { assigneeName: "Grace" }],
      ["priority", { priority: "low" }],
      ["subject", { subject: "Renamed" }],
      ["channel", { channel: "chat" }],
      ["closing time", { closedAt: new Date("2026-09-02T00:00:00Z") }],
      ["tags", { tags: ["vip", "billing"] }],
      ["attributes", { attributes: { status: "solved" } }],
      ["requester", { requesterName: "Someone else" }],
      ["tier", { tier: "gold" }],
    ])("reports a changed %s", async (_name, change) => {
      await projectCanonicalBatch(prisma, zendesk, withCustomer());
      const result = await projectCanonicalBatch(
        prisma,
        zendesk,
        batch({ customers: [{ ...known, name: "Acme" }], cases: [ticketCase("1", { customer: known, assigneeName: "Ada", priority: "high", ...change })] }),
      );
      expect(result.casesChanged).toBe(1);
      expect(result.customersChanged).toBe(0);
    });

    it("reports a changed customer link, a cleared one and a renamed customer", async () => {
      await projectCanonicalBatch(prisma, zendesk, withCustomer());
      const cleared = await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1", { assigneeName: "Ada", priority: "high" })] }));
      expect(cleared.casesChanged).toBe(1);
      const renamed = await projectCanonicalBatch(prisma, zendesk, batch({ customers: [{ ...known, name: "Acme Ltd" }] }));
      expect(renamed).toMatchObject({ customersChanged: 1, casesChanged: 0 });
    });

    it("ignores a field the adapter omits and the key order of stored attributes", async () => {
      await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1", { attributes: { b: 1, a: { y: 2, x: 1 } } })] }));
      const { requesterName: _requester, tier: _tier, tags: _tags, ...withoutOptional } = ticketCase("1");
      const reordered = await projectCanonicalBatch(
        prisma,
        zendesk,
        batch({ cases: [{ ...withoutOptional, attributes: { a: { x: 1, y: 2 }, b: 1 } }] }),
      );
      expect(reordered.casesChanged).toBe(0);
    });

    it("counts event creation and deletion, and a case deletion, as changes", async () => {
      const raw = await rawEvent(zendesk, "ticket:1:h");
      const withEvent = batch({ cases: [ticketCase("1")], eventGroups: [group("1", [raw], [event(raw)])] });
      const created = await projectCanonicalBatch(prisma, zendesk, withEvent);
      expect(created).toMatchObject({ casesChanged: 1, eventsCreated: 1 });
      const removed = await projectCanonicalBatch(prisma, zendesk, batch({ cases: [ticketCase("1")], eventGroups: [group("1", [raw], [])] }));
      expect(removed).toMatchObject({ casesChanged: 0, eventsCreated: 0, eventsDeleted: 1 });
      const deleted = await projectCanonicalBatch(prisma, zendesk, batch({ deletedCaseExternalIds: ["1"] }));
      expect(deleted.casesDeleted).toBe(1);
    });

    it("does not change a stored value or duplicate an event while detecting change (the upsert still touches `updatedAt`, as before)", async () => {
      const raw = await rawEvent(zendesk, "ticket:1:h");
      const input = batch({ cases: [ticketCase("1")], eventGroups: [group("1", [raw], [event(raw)])] });
      await projectCanonicalBatch(prisma, zendesk, input);
      const cases = async () => (await prisma.case.findMany()).map(({ updatedAt: _updatedAt, ...fields }) => fields);
      const before = { cases: await cases(), events: await prisma.normalizedEvent.findMany() };
      await projectCanonicalBatch(prisma, zendesk, input);
      await projectCanonicalBatch(prisma, zendesk, input);
      expect(await cases()).toEqual(before.cases);
      expect(await prisma.normalizedEvent.findMany()).toEqual(before.events);
    });
  });

  describe("links", () => {
    const T0 = new Date("2026-09-01T10:00:00Z");
    const T1 = new Date("2026-09-02T10:00:00Z");
    const T2 = new Date("2026-09-03T10:00:00Z");
    let caseId: string;
    let firstRaw: string;
    let latestRaw: string;

    beforeEach(async () => {
      caseId = (
        await prisma.case.create({
          data: { organizationId, externalId: "1", system: "zendesk", sourceIntegrationId: zendesk.id, openedAt: new Date("2026-09-01T09:00:00Z") },
        })
      ).id;
      firstRaw = await rawEvent(jira, "remote_link:ENG-1:5:a");
      latestRaw = await rawEvent(jira, "remote_link:ENG-1:5:b");
    });

    const remoteFact = (overrides: Partial<LinkFact> = {}): LinkFact => ({
      caseId,
      system: "jira",
      externalId: "ENG-1",
      method: "remote_link",
      methodOnUpdate: "remote_link",
      evidence: { remoteLink: { id: 5 } },
      evidenceMode: "merge",
      sourceRole: "work_tracker",
      linkedEvent: { sourceRawEventId: firstRaw, occurredAt: T0 },
      relinkedEvent: { sourceRawEventId: latestRaw, occurredAt: T1 },
      repairLinkedEvent: false,
      ...overrides,
    });
    const officialFact = (): LinkFact =>
      remoteFact({ method: "official_link", methodOnUpdate: "official_link", evidence: { officialLink: { id: 9 } } });

    const linkRow = () => prisma.caseLink.findFirstOrThrow({ where: { caseId, externalId: "ENG-1" } });
    const linkedEvents = () => prisma.normalizedEvent.findMany({ where: { caseId, type: "issue_linked" }, orderBy: { occurredAt: "asc" } });

    it("creates a certain link and one issue_linked event at the first observation", async () => {
      const result = await projectLinkFacts(prisma, [remoteFact()]);

      expect(result).toEqual({ created: 1, reactivated: 0, updated: 0 });
      expect(await linkRow()).toMatchObject({ system: "jira", method: "remote_link", confidence: "certain", unlinkedAt: null });
      expect((await linkedEvents()).map((e) => [e.sourceRawEventId, e.occurredAt, e.system, e.sourceRole, e.actor])).toEqual([
        [firstRaw, T0, "jira", "work_tracker", "system"],
      ]);
    });

    it("projecting the same fact again changes nothing and writes no second event", async () => {
      await projectLinkFacts(prisma, [remoteFact()]);
      const result = await projectLinkFacts(prisma, [remoteFact()]);

      expect(result).toEqual({ created: 0, reactivated: 0, updated: 1 });
      expect(await linkedEvents()).toHaveLength(1);
    });

    it("keeps both producers' evidence on one row, and official_link wins the method in either order", async () => {
      await projectLinkFacts(prisma, [remoteFact()]);
      await projectLinkFacts(prisma, [officialFact()]);
      expect(await linkRow()).toMatchObject({ method: "official_link", evidence: { remoteLink: { id: 5 }, officialLink: { id: 9 } } });

      await projectLinkFacts(prisma, [remoteFact({ evidence: { remoteLink: { id: 5, title: "again" } } })]);
      expect(await linkRow()).toMatchObject({ method: "official_link", evidence: { remoteLink: { id: 5, title: "again" }, officialLink: { id: 9 } } });
      expect(await prisma.caseLink.count({ where: { caseId } })).toBe(1);
      expect(await linkedEvents()).toHaveLength(1);
    });

    it("replaces evidence when asked to, and keeps the method when the producer does not own it", async () => {
      await projectLinkFacts(prisma, [remoteFact({ method: "pattern", methodOnUpdate: "keep", evidence: { title: "one" }, evidenceMode: "replace" })]);
      await projectLinkFacts(prisma, [remoteFact({ method: "pattern", methodOnUpdate: "keep", evidence: { title: "two" }, evidenceMode: "replace" })]);

      expect(await linkRow()).toMatchObject({ method: "pattern", evidence: { title: "two" } });
    });

    it("re-activates an unlinked row on the same row, with a fresh event at the latest observation", async () => {
      await projectLinkFacts(prisma, [remoteFact()]);
      await prisma.caseLink.updateMany({ where: { caseId }, data: { unlinkedAt: T1 } });

      const result = await projectLinkFacts(prisma, [remoteFact()]);

      expect(result).toEqual({ created: 0, reactivated: 1, updated: 0 });
      expect((await linkRow()).unlinkedAt).toBeNull();
      expect(await prisma.caseLink.count({ where: { caseId } })).toBe(1);
      expect((await linkedEvents()).map((e) => [e.sourceRawEventId, e.occurredAt])).toEqual([
        [firstRaw, T0],
        [latestRaw, T1],
      ]);
    });

    it("repairs a missing issue_linked event only when asked to", async () => {
      await prisma.caseLink.create({
        data: { caseId, system: "jira", externalId: "ENG-1", method: "remote_link", confidence: "certain", evidence: {} },
      });

      await projectLinkFacts(prisma, [remoteFact()]);
      expect(await linkedEvents()).toHaveLength(0);

      await projectLinkFacts(prisma, [remoteFact({ repairLinkedEvent: true })]);
      await projectLinkFacts(prisma, [remoteFact({ repairLinkedEvent: true })]);
      expect(await linkedEvents()).toHaveLength(1);
    });

    describe("sweep", () => {
      const sweepFor = (evidenceKey: "remoteLink" | "officialLink", activeLinkIds: number[], withManifest = true): LinkSweep => ({
        system: "jira",
        evidenceKey,
        otherEvidenceKey: evidenceKey === "remoteLink" ? "officialLink" : "remoteLink",
        sourceRole: "work_tracker",
        manifestFor: () => (withManifest ? { rawEventId: latestRaw, fetchedAt: T2, activeLinkIds: new Set(activeLinkIds) } : null),
      });
      const unlinkedEvents = () => prisma.normalizedEvent.findMany({ where: { caseId, type: "issue_unlinked" } });

      it("unlinks a link the manifest dropped, records the removal and emits issue_unlinked", async () => {
        await projectLinkFacts(prisma, [remoteFact()]);

        const result = await projectLinkSweep(prisma, organizationId, sweepFor("remoteLink", []));

        expect(result).toEqual({ unlinked: 1 });
        const row = await linkRow();
        expect(row.unlinkedAt).toEqual(T2);
        expect(row.evidence).toMatchObject({ remoteLink: { id: 5 }, remoteLinkRemovedAt: T2.toISOString() });
        expect((await unlinkedEvents()).map((e) => [e.sourceRawEventId, e.occurredAt, e.system, e.sourceRole])).toEqual([
          [latestRaw, T2, "jira", "work_tracker"],
        ]);
      });

      it("leaves a link the manifest still reports, and one with no manifest", async () => {
        await projectLinkFacts(prisma, [remoteFact()]);

        expect(await projectLinkSweep(prisma, organizationId, sweepFor("remoteLink", [5]))).toEqual({ unlinked: 0 });
        expect(await projectLinkSweep(prisma, organizationId, sweepFor("remoteLink", [], false))).toEqual({ unlinked: 0 });
        expect((await linkRow()).unlinkedAt).toBeNull();
        expect(await unlinkedEvents()).toHaveLength(0);
      });

      it("does not unlink what the other source still proves, but stamps the removal", async () => {
        await projectLinkFacts(prisma, [remoteFact(), officialFact()]);

        const result = await projectLinkSweep(prisma, organizationId, sweepFor("remoteLink", []));

        expect(result).toEqual({ unlinked: 0 });
        const row = await linkRow();
        expect(row.unlinkedAt).toBeNull();
        expect(row.evidence).toMatchObject({ remoteLinkRemovedAt: T2.toISOString() });
        expect(await unlinkedEvents()).toHaveLength(0);
      });

      it("finishes the unlink when the other source is removed in a later run", async () => {
        await projectLinkFacts(prisma, [remoteFact(), officialFact()]);
        await projectLinkSweep(prisma, organizationId, sweepFor("remoteLink", []));

        const result = await projectLinkSweep(prisma, organizationId, sweepFor("officialLink", []));

        expect(result).toEqual({ unlinked: 1 });
        const row = await linkRow();
        expect(row.unlinkedAt).toEqual(T2);
        expect(row.evidence).toMatchObject({ remoteLinkRemovedAt: T2.toISOString(), officialLinkRemovedAt: T2.toISOString() });
        expect(await unlinkedEvents()).toHaveLength(1);
      });

      it("only sweeps the organization it is given", async () => {
        const other = await prisma.organization.create({ data: { name: "Other Org" } });
        const otherCase = await prisma.case.create({ data: { organizationId: other.id, externalId: "1", system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, other.id, "zendesk"), openedAt: T0 } });
        await prisma.caseLink.create({
          data: { caseId: otherCase.id, system: "jira", externalId: "ENG-1", method: "remote_link", confidence: "certain", evidence: { remoteLink: { id: 5 } } },
        });

        expect(await projectLinkSweep(prisma, organizationId, sweepFor("remoteLink", []))).toEqual({ unlinked: 0 });
        expect((await prisma.caseLink.findFirstOrThrow({ where: { caseId: otherCase.id } })).unlinkedAt).toBeNull();
      });
    });
  });

  describe("projectIssueRemoval", () => {
    const T0 = new Date("2026-09-01T09:00:00Z");
    const T3 = new Date("2026-09-03T09:00:00Z");

    async function linkedCase(externalId: string, issue: string): Promise<string> {
      const caseRow = await prisma.case.create({
        data: { organizationId, externalId, system: "zendesk", sourceIntegrationId: zendesk.id, openedAt: T0 },
      });
      await prisma.caseLink.create({
        data: { caseId: caseRow.id, system: "jira", externalId: issue, method: "remote_link", confidence: "certain", evidence: {} },
      });
      return caseRow.id;
    }

    let deliveries = 0;
    const removal = async (issue: string) => ({
      organizationId,
      system: "jira" as const,
      externalId: issue,
      // Each detection is its own occurrence, so its own raw event.
      rawEventId: await rawEvent(jira, `issue_deleted:${issue}:${(deliveries += 1)}`),
      observedAt: T3,
      sourceRole: "work_tracker" as const,
    });

    it("unlinks every active link to the issue and emits one issue_unlinked event each, keeping the rows", async () => {
      const a = await linkedCase("1", "ENG-1");
      const b = await linkedCase("2", "ENG-1");
      const untouched = await linkedCase("3", "ENG-2");

      expect(await projectIssueRemoval(prisma, await removal("ENG-1"))).toEqual({ unlinked: 2 });

      for (const caseId of [a, b]) {
        expect((await prisma.caseLink.findFirstOrThrow({ where: { caseId } })).unlinkedAt).toEqual(T3);
        expect(await prisma.normalizedEvent.findMany({ where: { caseId, type: "issue_unlinked" } })).toMatchObject([
          { system: "jira", sourceRole: "work_tracker", occurredAt: T3 },
        ]);
      }
      expect((await prisma.caseLink.findFirstOrThrow({ where: { caseId: untouched } })).unlinkedAt).toBeNull();
    });

    it("is a no-op for a redelivery, and never reaches another organization's links", async () => {
      await linkedCase("1", "ENG-1");
      expect(await projectIssueRemoval(prisma, await removal("ENG-1"))).toEqual({ unlinked: 1 });
      expect(await projectIssueRemoval(prisma, await removal("ENG-1"))).toEqual({ unlinked: 0 });
      expect(await prisma.normalizedEvent.count({ where: { type: "issue_unlinked" } })).toBe(1);

      const other = await prisma.organization.create({ data: { name: "Other Org" } });
      const otherCase = await prisma.case.create({
        data: { organizationId: other.id, externalId: "1", system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, other.id, "zendesk"), openedAt: T0 },
      });
      await prisma.caseLink.create({ data: { caseId: otherCase.id, system: "jira", externalId: "ENG-1", method: "remote_link", confidence: "certain" } });
      expect(await projectIssueRemoval(prisma, await removal("ENG-1"))).toEqual({ unlinked: 0 });
      expect((await prisma.caseLink.findFirstOrThrow({ where: { caseId: otherCase.id } })).unlinkedAt).toBeNull();
    });
  });
});
