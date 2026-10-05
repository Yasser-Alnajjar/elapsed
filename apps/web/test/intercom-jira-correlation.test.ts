/**
 * Intercom -> Jira correlation through the `jira_issue_key` custom attribute,
 * with Intercom Tracker tickets as link records rather than Cases.
 *
 * Intercom's Jira integration leaves nothing on the Jira issue (no remote
 * link, issue link, label or description), so `correlateJira` can never see
 * the relationship; the only record is `jira_issue_key` on the Intercom object
 * the issue was created from. The fixture is the live record that exposed the
 * gap: customer conversation 215476246219089 had two Tracker tickets made from
 * it (…230453, which Intercom then gave SCRUM-23 at 12:48:55 UTC, and …247469,
 * which has no key). A Tracker is the link between conversations and an
 * engineering issue (the role Zendesk's official Jira-link record plays), so
 * it is not a Case, and its key lands on every conversation that lists it.
 *
 * Real Postgres, like official-link-correlation.test.ts: CaseLink identity is
 * a real unique constraint and the Intercom batch must not reconcile the link
 * events away. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { correlateIntegration, correlateZendeskLinks, normalizeIntegration, normalizeJira } from "./ingest-helpers";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const TRACKER = "215476246230453"; // carries SCRUM-23 once Intercom's Jira integration ran
const SECOND_TRACKER = "215476246247469"; // titled like the Jira issue, never given a key
const CONVERSATION = "215476246219089"; // the customer conversation both trackers were made from
const OTHER_CONVERSATION = "215476246409710";

const T_LIST = new Date("2026-10-05T12:44:57.765Z"); // the conversation, listing both trackers
const T0 = new Date("2026-10-05T12:43:27.495Z"); // tracker first fetched, no key yet
const T1 = new Date("2026-10-05T12:49:06.614Z"); // fetched after Intercom set jira_issue_key
const T2 = new Date("2026-10-05T12:55:00.000Z");
const T3 = new Date("2026-10-05T13:05:00.000Z");

describe.skipIf(!TEST_DATABASE_URL)("Intercom jira_issue_key correlation (real Postgres)", () => {
  let prisma: PrismaClient;
  let intercom: typeof import("@sla/intercom");
  let zendesk: typeof import("@sla/zendesk");
  let jira: typeof import("@sla/jira");
  let organizationId: string;
  let integrationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    intercom = await import("@sla/intercom");
    zendesk = await import("@sla/zendesk");
    jira = await import("@sla/jira");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    organizationId = (await prisma.organization.create({ data: { name: "Intercom Org" } })).id;
    integrationId = (await prisma.integration.create({ data: { organizationId, provider: "intercom", credentials: { workspaceId: "dk5cd3tx" } } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  type Fixture = Record<string, unknown>;

  /** An Intercom Tracker ticket in the shape the live API returned: no contact, pointing back at its conversations. */
  const tracker = (id: string, attributes: Record<string, unknown> = {}, conversations: string[] = [CONVERSATION], title: string | null = null): Fixture => ({
    id,
    created_at: 1791204176,
    state: "open",
    open: true,
    priority: "not_priority",
    source: { id, type: "admin_initiated", delivered_as: "admin_initiated", subject: "", author: { id: "11797391", type: "admin" } },
    ticket: { id: Number(id), type: "ticket", ticket_type: "Issue", custom_attributes: { _default_title_: { type: "string", value: title } } },
    contacts: { contacts: [] },
    custom_attributes: { "Ticket category": "Tracker ticket", "Issue type": "Escalation", "Customer reports": 1, ...(title ? { _default_title_: title } : {}), ...attributes },
    linked_objects: { type: "list", data: conversations.map((c) => ({ id: c, type: "conversation", category: null })) },
  });

  /** A customer conversation or ticket; `trackers` are the Tracker tickets it lists in `linked_objects`. */
  const conversation = (id: string, trackers: string[] = [], overrides: Fixture = {}): Fixture => ({
    id,
    created_at: 1791204087,
    state: "closed",
    open: false,
    priority: "not_priority",
    source: { id: "4009045362", type: "conversation", subject: "", author: { id: "u1", type: "user" } },
    contacts: { contacts: [{ id: "6ac38a41562010e5ab52dc74", type: "contact", external_id: "test-user-004" }] },
    custom_attributes: { Language: "Arabic" },
    linked_objects: { type: "list", data: trackers.map((t) => ({ id: t, type: "ticket", category: "Tracker" })) },
    ...overrides,
  });

  /** Seeds one snapshot the way the backfill would: the real mapper, with a controlled `fetchedAt`. */
  async function snapshot(payload: Fixture, fetchedAt: Date) {
    // Intercom bumps `updated_at` on every change, so each real snapshot has distinct content (and hash).
    const input = intercom.mapConversationToRawEvent({ ...payload, updated_at: Math.floor(fetchedAt.getTime() / 1000) } as never);
    return prisma.rawEvent.create({
      data: { integrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as object, fetchedAt },
    });
  }

  /** The production state: both trackers fetched, then the conversation listing them, then the key set on the first tracker. */
  async function seedProduction() {
    const trackerBefore = await snapshot(tracker(TRACKER), T0);
    await snapshot(tracker(SECOND_TRACKER, {}, [CONVERSATION], "العميل زعلان"), new Date("2026-10-05T12:44:58.503Z"));
    await snapshot(conversation(CONVERSATION, [TRACKER, SECOND_TRACKER]), T_LIST);
    const trackerWithKey = await snapshot(tracker(TRACKER, { jira_issue_key: "SCRUM-23" }), T1);
    await normalizeIntegration(prisma, integrationId);
    return { trackerBefore, trackerWithKey };
  }

  const caseOf = (externalId: string) => prisma.case.findFirstOrThrow({ where: { organizationId, externalId } });
  const maybeCase = (externalId: string) => prisma.case.findFirst({ where: { organizationId, externalId } });
  const linksOf = (caseId: string) => prisma.caseLink.findMany({ where: { caseId }, orderBy: { externalId: "asc" } });
  const eventsOf = (caseId: string, type: string) => prisma.normalizedEvent.findMany({ where: { caseId, type }, orderBy: { occurredAt: "asc" } });
  const correlate = () => correlateIntegration(prisma, integrationId);

  it("makes no Case for a Tracker ticket, only for the customer conversation", async () => {
    await seedProduction();

    const conversationCase = await caseOf(CONVERSATION);
    expect(conversationCase).toMatchObject({ system: "intercom", channel: "conversation", deletedAt: null });
    expect(conversationCase.customerId).not.toBeNull();
    expect(await maybeCase(TRACKER)).toBeNull();
    expect(await maybeCase(SECOND_TRACKER)).toBeNull();
  });

  it("links the conversation to SCRUM-23 through its Tracker, as a certain official_link with the tracker as evidence", async () => {
    const { trackerWithKey } = await seedProduction();

    const result = await correlate();

    expect(result).toMatchObject({ caseLinksCreated: 1, caseLinksUnlinked: 0 });
    const conversationCase = await caseOf(CONVERSATION);
    const links = await linksOf(conversationCase.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ system: "jira", externalId: "SCRUM-23", method: "official_link", confidence: "certain", unlinkedAt: null });
    expect(links[0]!.evidence).toEqual({
      intercomJiraKey: { id: Number(CONVERSATION), conversationId: CONVERSATION, attribute: "jira_issue_key", value: "SCRUM-23", trackerId: TRACKER },
    });

    // The event cites the snapshot at which the relationship began to hold (the tracker gaining the key,
    // after the conversation already listed it), not the earlier tracker snapshot without a key.
    const [linked, ...rest] = await eventsOf(conversationCase.id, "issue_linked");
    expect(rest).toEqual([]);
    expect(linked).toMatchObject({ system: "jira", sourceRole: "work_tracker", sourceRawEventId: trackerWithKey.id, occurredAt: T1 });
  });

  it("links nothing from the keyless second Tracker, and does not link before the key exists", async () => {
    await snapshot(tracker(TRACKER), T0);
    await snapshot(tracker(SECOND_TRACKER, {}, [CONVERSATION], "العميل زعلان"), T0);
    await snapshot(conversation(CONVERSATION, [TRACKER, SECOND_TRACKER]), T_LIST);
    await normalizeIntegration(prisma, integrationId);

    expect(await correlate()).toMatchObject({ caseLinksCreated: 0 });
    expect(await prisma.caseLink.count()).toBe(0);

    await snapshot(tracker(TRACKER, { jira_issue_key: "SCRUM-23" }), T1);
    await correlate();

    expect((await prisma.caseLink.findMany()).map((l) => l.externalId)).toEqual(["SCRUM-23"]);
  });

  it("does not infer a link from a matching title: a conversation not linked to the Tracker stays unlinked", async () => {
    await seedProduction();
    // The Jira issue's summary is the second tracker's title; this unrelated conversation has that exact subject.
    await snapshot(conversation(OTHER_CONVERSATION, [], { source: { type: "conversation", subject: "العميل زعلان", author: { id: "u1", type: "user" } }, title: "العميل زعلان" }), T2);
    await normalizeIntegration(prisma, integrationId);

    await correlate();

    expect(await linksOf((await caseOf(OTHER_CONVERSATION)).id)).toEqual([]);
    expect(await prisma.caseLink.count()).toBe(1);
  });

  it("is idempotent, and keeps the issue_linked event across Intercom re-normalization", async () => {
    await seedProduction();
    await correlate();
    const conversationCase = await caseOf(CONVERSATION);
    const before = { links: await prisma.caseLink.findMany(), events: await prisma.normalizedEvent.count(), linked: await eventsOf(conversationCase.id, "issue_linked") };

    const again = await correlate();
    await normalizeIntegration(prisma, integrationId, { mode: "full" });
    await correlate();

    expect(again).toMatchObject({ caseLinksCreated: 0, caseLinksReactivated: 0, caseLinksUnlinked: 0 });
    expect(await prisma.caseLink.count()).toBe(before.links.length);
    expect(await prisma.normalizedEvent.count()).toBe(before.events);
    expect((await eventsOf(conversationCase.id, "issue_linked")).map((e) => e.id)).toEqual(before.linked.map((e) => e.id));
    expect(await prisma.caseLink.findMany()).toMatchObject([{ id: before.links[0]!.id, externalId: "SCRUM-23", unlinkedAt: null }]);
  });

  it("replaces the relationship when the Tracker's key changes: the new issue links, the old one unlinks", async () => {
    await seedProduction();
    await correlate();
    const replacing = await snapshot(tracker(TRACKER, { jira_issue_key: "SCRUM-24" }), T2);

    const result = await correlate();

    expect(result).toMatchObject({ caseLinksCreated: 1, caseLinksUnlinked: 1 });
    const conversationCase = await caseOf(CONVERSATION);
    expect((await linksOf(conversationCase.id)).map((l) => [l.externalId, l.unlinkedAt?.toISOString() ?? null])).toEqual([
      ["SCRUM-23", T2.toISOString()],
      ["SCRUM-24", null],
    ]);
    expect(await eventsOf(conversationCase.id, "issue_unlinked")).toMatchObject([{ system: "jira", sourceRole: "work_tracker", sourceRawEventId: replacing.id, occurredAt: T2 }]);
    expect(await eventsOf(conversationCase.id, "issue_linked")).toHaveLength(2);
  });

  it("unlinks, without deleting, when the key is cleared, and relinks with a fresh event if it returns", async () => {
    const { trackerWithKey } = await seedProduction();
    await correlate();
    const cleared = await snapshot(tracker(TRACKER), T2);

    const result = await correlate();

    expect(result).toMatchObject({ caseLinksCreated: 0, caseLinksUnlinked: 1 });
    const conversationCase = await caseOf(CONVERSATION);
    const [link] = await linksOf(conversationCase.id);
    expect(link).toMatchObject({ externalId: "SCRUM-23", unlinkedAt: T2 });
    expect((link!.evidence as Record<string, unknown>).intercomJiraKey).toMatchObject({ value: "SCRUM-23", trackerId: TRACKER });
    expect(await eventsOf(conversationCase.id, "issue_unlinked")).toMatchObject([{ sourceRawEventId: cleared.id, occurredAt: T2 }]);
    expect(await correlate()).toMatchObject({ caseLinksCreated: 0, caseLinksReactivated: 0, caseLinksUnlinked: 0 });

    const restored = await snapshot(tracker(TRACKER, { jira_issue_key: "SCRUM-23", "Customer reports": 2 }), T3);
    const relinked = await correlate();

    expect(relinked).toMatchObject({ caseLinksCreated: 0, caseLinksReactivated: 1 });
    expect(await linksOf(conversationCase.id)).toMatchObject([{ id: link!.id, unlinkedAt: null }]);
    expect((await eventsOf(conversationCase.id, "issue_linked")).map((e) => e.sourceRawEventId)).toEqual([trackerWithKey.id, restored.id]);
  });

  it("unlinks when the conversation stops listing the Tracker", async () => {
    await seedProduction();
    await correlate();
    const unlisted = await snapshot(conversation(CONVERSATION, [SECOND_TRACKER]), T2);

    const result = await correlate();

    expect(result).toMatchObject({ caseLinksCreated: 0, caseLinksUnlinked: 1 });
    const conversationCase = await caseOf(CONVERSATION);
    expect(await linksOf(conversationCase.id)).toMatchObject([{ externalId: "SCRUM-23", unlinkedAt: T2 }]);
    expect(await eventsOf(conversationCase.id, "issue_unlinked")).toMatchObject([{ sourceRawEventId: unlisted.id }]);
  });

  it("links every conversation that lists a shared Tracker, and unlinks them one at a time", async () => {
    await seedProduction();
    await snapshot(tracker(TRACKER, { jira_issue_key: "SCRUM-23" }, [CONVERSATION, OTHER_CONVERSATION]), T1);
    await snapshot(conversation(OTHER_CONVERSATION, [TRACKER]), T2);
    await normalizeIntegration(prisma, integrationId);

    await correlate();

    for (const externalId of [CONVERSATION, OTHER_CONVERSATION]) {
      const row = await caseOf(externalId);
      expect(await linksOf(row.id)).toMatchObject([{ externalId: "SCRUM-23", unlinkedAt: null }]);
      expect(await eventsOf(row.id, "issue_linked")).toHaveLength(1);
    }
    expect(await prisma.caseLink.count()).toBe(2);

    await snapshot(conversation(OTHER_CONVERSATION, []), T3);
    await correlate();

    expect(await linksOf((await caseOf(OTHER_CONVERSATION)).id)).toMatchObject([{ unlinkedAt: T3 }]);
    expect(await linksOf((await caseOf(CONVERSATION)).id)).toMatchObject([{ unlinkedAt: null }]);
  });

  it("links a conversation to each of several Trackers that carry a key", async () => {
    await seedProduction();
    await snapshot(tracker(SECOND_TRACKER, { jira_issue_key: "SCRUM-30" }, [CONVERSATION], "العميل زعلان"), T2);

    await correlate();

    expect((await linksOf((await caseOf(CONVERSATION)).id)).map((l) => [l.externalId, l.unlinkedAt])).toEqual([["SCRUM-23", null], ["SCRUM-30", null]]);
  });

  it("links a customer ticket that carries the key itself, to its own Case", async () => {
    await snapshot(conversation(OTHER_CONVERSATION, [], { custom_attributes: { "Ticket category": "Customer ticket", jira_issue_key: "PROJ-7" }, ticket: { id: 1, type: "ticket" } }), T1);
    await normalizeIntegration(prisma, integrationId);

    await correlate();

    const row = await caseOf(OTHER_CONVERSATION);
    // Its issue_linked event cites the Case's own snapshot, which the Intercom batch owns: it must survive re-normalization.
    await normalizeIntegration(prisma, integrationId, { mode: "full" });
    expect(await eventsOf(row.id, "issue_linked")).toHaveLength(1);
    expect(await linksOf(row.id)).toMatchObject([{ externalId: "PROJ-7", method: "official_link" }]);
    expect((await linksOf(row.id))[0]!.evidence).toEqual({
      intercomJiraKey: { id: Number(OTHER_CONVERSATION), conversationId: OTHER_CONVERSATION, attribute: "jira_issue_key", value: "PROJ-7" },
    });
  });

  it("treats a blank or malformed key as no key", async () => {
    await snapshot(conversation(CONVERSATION, [TRACKER, SECOND_TRACKER]), T_LIST);
    await snapshot(tracker(TRACKER, { jira_issue_key: "   " }), T1);
    await snapshot(tracker(SECOND_TRACKER, { jira_issue_key: "not a key" }), T1);
    await normalizeIntegration(prisma, integrationId);

    const result = await correlate();

    expect(result).toMatchObject({ caseLinksCreated: 0 });
    expect(await prisma.caseLink.count()).toBe(0);
  });

  it("does not link a deleted conversation Case", async () => {
    await seedProduction();
    await prisma.case.update({ where: { id: (await caseOf(CONVERSATION)).id }, data: { deletedAt: new Date() } });

    expect(await correlate()).toMatchObject({ caseLinksCreated: 0, unmatchedNoCase: 1 });
  });

  it("retires what an earlier version put on a Tracker's own Case: the Case is soft-deleted and its link unlinked", async () => {
    // State left by the first version: a Case for the Tracker holding the SCRUM-23 link.
    const trackerWithKey = await snapshot(tracker(TRACKER, { jira_issue_key: "SCRUM-23" }), T1);
    const legacyCase = await prisma.case.create({
      data: { organizationId, system: "intercom", sourceIntegrationId: integrationId, externalId: TRACKER, channel: "admin_initiated", openedAt: new Date("2026-10-05T12:42:56Z") },
    });
    const legacyLink = await prisma.caseLink.create({
      data: {
        caseId: legacyCase.id,
        system: "jira",
        externalId: "SCRUM-23",
        method: "official_link",
        confidence: "certain",
        evidence: { intercomJiraKey: { id: Number(TRACKER), conversationId: TRACKER, attribute: "jira_issue_key", value: "SCRUM-23" } },
      },
    });
    await snapshot(conversation(CONVERSATION, [TRACKER]), T_LIST);

    const normalized = await normalizeIntegration(prisma, integrationId);
    const result = await correlate();

    expect(normalized.casesDeleted).toBe(1);
    expect((await caseOf(TRACKER)).deletedAt).not.toBeNull();
    expect(result).toMatchObject({ caseLinksCreated: 1, caseLinksUnlinked: 1 });
    expect(await prisma.caseLink.findUniqueOrThrow({ where: { id: legacyLink.id } })).toMatchObject({ unlinkedAt: trackerWithKey.fetchedAt });
    expect(await linksOf((await caseOf(CONVERSATION)).id)).toMatchObject([{ externalId: "SCRUM-23", unlinkedAt: null }]);
  });

  it("feeds the existing Jira normalization: the issue's events land on the conversation Case", async () => {
    await seedProduction();
    await correlate();
    const jiraId = (
      await prisma.integration.create({ data: { organizationId, provider: "jira", credentials: { cloudId: "c", siteUrl: "https://acme.atlassian.net", accessToken: "t", tokenType: "bearer" } } })
    ).id;
    for (const raw of [
      jira.mapStatusToRawEvent({ id: "10000", name: "To Do", statusCategory: { key: "new", name: "To Do" } } as never),
      jira.mapIssueToRawEvent({
        id: "10246",
        key: "SCRUM-23",
        fields: {
          summary: "العميل زعلان",
          status: { id: "10000", name: "To Do" },
          priority: null,
          project: { id: "10000", key: "SCRUM", name: "SLA TEAM" },
          created: "2026-10-05T15:48:53.632+0300",
          updated: "2026-10-05T15:48:53.833+0300",
          reporter: null,
          assignee: null,
        },
      } as never),
    ]) {
      await prisma.rawEvent.create({ data: { integrationId: jiraId, providerEventId: raw.providerEventId, sourceHash: raw.sourceHash, payload: raw.payload as object } });
    }

    await normalizeJira(prisma, jiraId);

    const jiraEvents = (await prisma.normalizedEvent.findMany({ where: { caseId: (await caseOf(CONVERSATION)).id, system: "jira" } })).map((e) => e.type);
    expect(jiraEvents).toContain("issue_linked");
    expect(jiraEvents.filter((t) => t !== "issue_linked").length).toBeGreaterThan(0);
  });

  it("leaves Zendesk's official Jira links alone, and its sweep leaves this one alone", async () => {
    const zendeskId = (await prisma.integration.create({ data: { organizationId, provider: "zendesk", credentials: { subdomain: "acme", accessToken: "t", tokenType: "bearer", scope: "read" } } })).id;
    const zendeskCase = await prisma.case.create({ data: { organizationId, system: "zendesk", sourceIntegrationId: zendeskId, externalId: "13", openedAt: new Date("2026-10-01") } });
    const link = zendesk.mapJiraLinkToRawEvent({ id: 81003289, ticket_id: "13", issue_id: "10745", issue_key: "SCRUM-5" });
    const manifest = zendesk.mapJiraLinkManifestToRawEvent([81003289]);
    await prisma.rawEvent.createMany({
      data: [link, manifest].map((i) => ({ integrationId: zendeskId, providerEventId: i.providerEventId, sourceHash: i.sourceHash, payload: i.payload as object })),
    });
    await correlateZendeskLinks(prisma, zendeskId);

    await seedProduction();
    await correlate(); // its sweep sees SCRUM-5 and must not touch it
    await correlateZendeskLinks(prisma, zendeskId); // Zendesk's sweep sees SCRUM-23 and must not touch it

    expect(await linksOf(zendeskCase.id)).toMatchObject([{ externalId: "SCRUM-5", method: "official_link", unlinkedAt: null }]);
    expect(await linksOf((await caseOf(CONVERSATION)).id)).toMatchObject([{ externalId: "SCRUM-23", method: "official_link", unlinkedAt: null }]);
    expect(await prisma.normalizedEvent.count({ where: { type: "issue_unlinked" } })).toBe(0);
  });
});
