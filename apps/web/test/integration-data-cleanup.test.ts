/**
 * Integration data cleanup against a real Postgres: disconnect and cleanup are
 * separate actions. Disconnect never deletes data and never makes the details
 * page unreachable; cleanup is explicit, refused unless the integration is
 * disconnected, scoped to that one integration, and keeps whatever another
 * integration or the organization still needs.
 *
 * The same suite covers Settings → Data: the per-integration counts and read
 * model (a disconnected integration with data still appears), the backup export
 * (read-only, covers exactly what a cleanup deletes, independent of cleanup) and
 * the audit trail both write.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test";
 * skipped when unset. Only the session is mocked (like
 * integration-disconnect-routes.test.ts); the routes and the cleanup run for real.
 */
import type { Session } from "next-auth";
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const ACTOR = { userId: null, email: "owner@tenant.test" };

function sessionFor(organizationId: string): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email: "owner@tenant.test", emailVerifiedAt: new Date(), name: null, image: null, role: "owner", createdAt: new Date() },
  };
}

describe.skipIf(!TEST_DATABASE_URL)("integration data cleanup (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
  });

  beforeEach(async () => {
    auth.session = null;
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * One organization with a Zendesk and an Intercom ticket source and a Jira
   * engineering source, each with raw events, plus:
   *  - zCase1 (customer cOnlyZendesk): Jira events and a Jira link evidenced by both Jira and Zendesk.
   *  - zCase2 (customer cShared): a Jira link evidenced by Jira alone.
   *  - iCase (customer cShared, which also has an Intercom identity): a Jira link from Intercom alone.
   *  - cCalendar / cPolicy: Zendesk-only customers that a calendar override / SLA policy still needs.
   */
  async function seedOrganization(name: string) {
    const organization = await prisma.organization.create({ data: { name } });
    const organizationId = organization.id;

    const integrationFor = (provider: "zendesk" | "intercom" | "jira") =>
      prisma.integration.create({
        data: {
          organizationId,
          provider,
          status: "connected",
          credentials: { accessToken: "x", subdomain: provider === "zendesk" ? "acme" : undefined },
          cursor: { backfillCompletedAt: "2026-09-01T00:00:00.000Z" },
          webhookSecret: `${name}-${provider}-secret`,
          lastSyncAt: new Date("2026-10-01T00:00:00Z"),
          normalizedThroughFetchedAt: new Date("2026-10-01T00:00:00Z"),
          normalizedThroughId: "raw-x",
          renormalizeRequestedAt: new Date("2026-10-02T00:00:00Z"),
        },
      });
    const zendesk = await integrationFor("zendesk");
    const intercom = await integrationFor("intercom");
    const jira = await integrationFor("jira");

    const raw = async (integrationId: string, id: string) =>
      prisma.rawEvent.create({ data: { integrationId, providerEventId: `${name}-${id}`, sourceHash: id, payload: { id } } });
    const zRaw1 = await raw(zendesk.id, "z1");
    const zRaw2 = await raw(zendesk.id, "z2");
    const iRaw = await raw(intercom.id, "i1");
    const jRaw1 = await raw(jira.id, "j1");
    const jRaw2 = await raw(jira.id, "j2");

    const calendar = await prisma.businessCalendar.create({
      data: { organizationId, name: "Standard", versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } } },
      include: { versions: true },
    });

    const customer = (customerName: string, identities: { provider: "zendesk" | "intercom"; kind: string; externalId: string }[], extra = {}) =>
      prisma.customer.create({
        data: {
          organizationId,
          name: customerName,
          ...extra,
          identities: { create: identities.map((identity) => ({ organizationId, ...identity })) },
        },
      });
    const cOnlyZendesk = await customer("OnlyZendesk", [{ provider: "zendesk", kind: "organization", externalId: `${name}-1` }]);
    const cShared = await customer("Shared", [
      { provider: "zendesk", kind: "organization", externalId: `${name}-2` },
      { provider: "intercom", kind: "company", externalId: `${name}-2` },
    ]);
    const cCalendar = await customer("Calendar", [{ provider: "zendesk", kind: "organization", externalId: `${name}-3` }], {
      calendarId: calendar.id,
      calendarVersionId: calendar.versions[0]!.id,
    });
    const cPolicy = await customer("Policy", [{ provider: "zendesk", kind: "organization", externalId: `${name}-4` }]);
    const policy = await prisma.sLAPolicy.create({
      data: {
        organizationId,
        name: "Gold",
        versions: {
          create: {
            version: 1,
            match: { customerIds: [cPolicy.id] },
            targets: [],
            pauseOnStates: [],
            calendarVersionId: calendar.versions[0]!.id,
            warnAtPercent: [],
            effectiveFrom: new Date("2026-01-01T00:00:00Z"),
          },
        },
      },
      include: { versions: true },
    });

    const caseFor = (integrationId: string, system: "zendesk" | "intercom", externalId: string, customerId: string) =>
      prisma.case.create({
        data: { organizationId, sourceIntegrationId: integrationId, system, externalId: `${name}-${externalId}`, customerId, openedAt: new Date("2026-09-10T00:00:00Z") },
      });
    const zCase1 = await caseFor(zendesk.id, "zendesk", "z-1", cOnlyZendesk.id);
    const zCase2 = await caseFor(zendesk.id, "zendesk", "z-2", cShared.id);
    const iCase = await caseFor(intercom.id, "intercom", "i-1", cShared.id);

    const event = (caseId: string, rawId: string, system: "zendesk" | "intercom" | "jira", type: string, sourceRole: string) =>
      prisma.normalizedEvent.create({
        data: { caseId, sourceRawEventId: rawId, type, occurredAt: new Date("2026-09-10T01:00:00Z"), actor: "system", system, sourceRole },
      });
    await event(zCase1.id, zRaw1.id, "zendesk", "ticket_created", "ticket_source");
    await event(zCase1.id, jRaw1.id, "jira", "issue_state_changed", "work_tracker");
    // Written by Zendesk's official-link producer: a Jira-system event, but a Zendesk raw event.
    await event(zCase1.id, zRaw2.id, "jira", "issue_linked", "work_tracker");
    await event(zCase2.id, zRaw2.id, "zendesk", "ticket_created", "ticket_source");
    await event(zCase2.id, jRaw2.id, "jira", "issue_linked", "work_tracker");
    await event(iCase.id, iRaw.id, "intercom", "ticket_created", "ticket_source");
    await event(iCase.id, jRaw2.id, "jira", "issue_state_changed", "work_tracker");

    // An SLA commitment on zCase1, with an evaluation and an alert: derived data that goes with the case.
    const commitment = await prisma.commitment.create({
      data: {
        caseId: zCase1.id,
        kind: "first_response",
        policyVersionId: policy.versions[0]!.id,
        calendarVersionId: calendar.versions[0]!.id,
        startedAt: new Date("2026-09-10T00:00:00Z"),
        targetMinutes: 60,
        dueAt: new Date("2026-09-10T01:00:00Z"),
      },
    });
    await prisma.evaluation.create({
      data: { commitmentId: commitment.id, evaluatedAt: new Date("2026-09-10T00:30:00Z"), elapsedSeconds: 1800, remainingSeconds: 1800, status: "on_track", inputs: {} },
    });
    await prisma.notification.create({ data: { commitmentId: commitment.id, threshold: 80, channel: "slack" } });

    const link = (caseId: string, externalId: string, method: "official_link" | "remote_link", evidence: object) =>
      prisma.caseLink.create({ data: { caseId, system: "jira", externalId, method, confidence: "certain", evidence } });
    await link(zCase1.id, "K-1", "official_link", { remoteLink: { id: 1 }, officialLink: { id: 9 }, statusName: "Done" });
    await link(zCase2.id, "K-2", "remote_link", { remoteLink: { id: 2 } });
    await link(iCase.id, "K-3", "official_link", { intercomJiraKey: { id: 3 } });

    return { organizationId, zendesk, intercom, jira, customers: { cOnlyZendesk, cShared, cCalendar, cPolicy } };
  }

  async function snapshot(organizationId: string) {
    const integrations = await prisma.integration.findMany({ where: { organizationId } });
    const count = async (provider: "zendesk" | "intercom" | "jira") => {
      const integration = integrations.find((i) => i.provider === provider)!;
      return {
        rawEvents: await prisma.rawEvent.count({ where: { integrationId: integration.id } }),
        cases: await prisma.case.count({ where: { sourceIntegrationId: integration.id } }),
        normalizedEvents: await prisma.normalizedEvent.count({ where: { sourceRawEvent: { integrationId: integration.id } } }),
      };
    };
    return {
      zendesk: await count("zendesk"),
      intercom: await count("intercom"),
      jira: await count("jira"),
      cases: await prisma.case.count({ where: { organizationId } }),
      links: await prisma.caseLink.count({ where: { case: { organizationId } } }),
      customers: await prisma.customer.count({ where: { organizationId } }),
      customerIdentities: await prisma.customerIdentity.count({ where: { organizationId } }),
      policies: await prisma.sLAPolicy.count({ where: { organizationId } }),
      calendars: await prisma.businessCalendar.count({ where: { organizationId } }),
    };
  }

  async function disconnectViaRoute(organizationId: string, provider: "zendesk" | "jira") {
    auth.session = sessionFor(organizationId);
    const { POST } = await import(`../src/app/api/integrations/${provider}/disconnect/route`);
    const response = await POST();
    expect(response.status).toBe(200);
  }

  async function cleanupViaRoute(organizationId: string, provider: string, body: unknown = { confirm: provider }) {
    auth.session = sessionFor(organizationId);
    const { POST } = await import("../src/app/api/integrations/[provider]/cleanup/route");
    return POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ provider }),
    });
  }

  it("disconnect alone deletes nothing, and the details page stays reachable for the disconnected integration", async () => {
    const { organizationId } = await seedOrganization("acme");
    const before = await snapshot(organizationId);

    await disconnectViaRoute(organizationId, "zendesk");
    await disconnectViaRoute(organizationId, "jira");

    expect(await snapshot(organizationId)).toEqual(before);

    const { getIntegrationDetailData } = await import("../src/lib/integration-detail-data");
    const zendeskDetail = await getIntegrationDetailData(prisma, organizationId, "zendesk");
    expect(zendeskDetail).not.toBeNull();
    expect(zendeskDetail).toMatchObject({
      provider: "zendesk",
      disconnected: true,
      importedData: { cases: 2, rawEvents: 2 },
      lastSyncAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect(zendeskDetail!.disconnectedAt).toBeInstanceOf(Date);
    expect(await getIntegrationDetailData(prisma, organizationId, "jira")).toMatchObject({ disconnected: true, importedData: { rawEvents: 2 } });
  });

  it("the details page is based on the integration existing: a provider that was never connected is still null", async () => {
    const { organizationId } = await seedOrganization("acme");
    const { getIntegrationDetailData } = await import("../src/lib/integration-detail-data");

    expect(await getIntegrationDetailData(prisma, organizationId, "linear")).toBeNull();
    expect(await getIntegrationDetailData(prisma, organizationId, "zendesk")).toMatchObject({ disconnected: false });
  });

  it("refuses to clean up a connected integration and deletes nothing", async () => {
    const { organizationId } = await seedOrganization("acme");
    const before = await snapshot(organizationId);

    expect(await db.cleanupIntegrationData(prisma, organizationId, "zendesk", ACTOR)).toEqual({ status: "not_disconnected" });
    expect((await cleanupViaRoute(organizationId, "zendesk")).status).toBe(409);
    expect(await snapshot(organizationId)).toEqual(before);
  });

  it("returns not_found for a provider with no integration row", async () => {
    const { organizationId } = await seedOrganization("acme");
    expect(await db.cleanupIntegrationData(prisma, organizationId, "linear", ACTOR)).toEqual({ status: "not_found" });
  });

  it("cleaning up a ticket source removes its cases, raw and derived events, and customers nobody else needs", async () => {
    const acme = await seedOrganization("acme");
    const other = await seedOrganization("other");
    const otherBefore = await snapshot(other.organizationId);
    await disconnectViaRoute(acme.organizationId, "zendesk");

    const response = await cleanupViaRoute(acme.organizationId, "zendesk");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "cleaned",
      counts: { rawEvents: 2, cases: 2, customerIdentities: 4, customers: 1 },
    });

    // Zendesk's own data is gone, including the Jira-system event Zendesk's official link wrote.
    expect(await snapshot(acme.organizationId)).toMatchObject({
      zendesk: { rawEvents: 0, cases: 0, normalizedEvents: 0 },
      // Everything else is untouched: Intercom and Jira keep their raw events, Intercom its case.
      intercom: { rawEvents: 1, cases: 1, normalizedEvents: 1 },
      jira: { rawEvents: 2 },
      cases: 1,
      policies: 1,
      calendars: 1,
    });
    // The Jira events that sat on Intercom's case survive; those on the deleted Zendesk cases went with them.
    expect(await prisma.normalizedEvent.count({ where: { sourceRawEvent: { integrationId: acme.jira.id } } })).toBe(1);

    // Customers: only the one nothing else needs is deleted.
    const remaining = await prisma.customer.findMany({ where: { organizationId: acme.organizationId }, select: { name: true } });
    expect(remaining.map((c) => c.name).sort()).toEqual(["Calendar", "Policy", "Shared"]);
    expect(await prisma.customerIdentity.findMany({ where: { organizationId: acme.organizationId }, select: { provider: true } })).toEqual([
      { provider: "intercom" },
    ]);

    // The integration remains, still disconnected, with its sync state reset and its identity kept.
    const row = await prisma.integration.findUniqueOrThrow({ where: { id: acme.zendesk.id } });
    expect(row).toMatchObject({
      status: "disconnected",
      cursor: null,
      normalizedThroughFetchedAt: null,
      normalizedThroughId: null,
      renormalizeRequestedAt: null,
      webhookSecret: "acme-zendesk-secret",
    });
    expect(row.disconnectedAt).toBeInstanceOf(Date);
    // Back to the never-synced state (SQL NULL, not a JSON null), so a reconnect backfills from scratch.
    const [cursorRow] = await prisma.$queryRaw<{ cursor_is_sql_null: boolean }[]>`
      SELECT cursor IS NULL AS cursor_is_sql_null FROM integrations WHERE id = ${acme.zendesk.id}`;
    expect(cursorRow?.cursor_is_sql_null).toBe(true);

    // The other organization is untouched.
    expect(await snapshot(other.organizationId)).toEqual(otherBefore);
  });

  it("cleaning up an engineering source removes its events and only its own link evidence", async () => {
    const acme = await seedOrganization("acme");
    const other = await seedOrganization("other");
    const otherBefore = await snapshot(other.organizationId);
    const before = await snapshot(acme.organizationId);
    await disconnectViaRoute(acme.organizationId, "jira");

    const result = await db.cleanupIntegrationData(prisma, acme.organizationId, "jira", ACTOR);
    expect(result).toEqual({
      status: "cleaned",
      counts: expect.objectContaining({ rawEvents: 2, normalizedEvents: 3, cases: 0, caseLinksRemoved: 1, caseLinksTrimmed: 1, customers: 0 }),
    });

    const after = await snapshot(acme.organizationId);
    expect(after.jira).toEqual({ rawEvents: 0, cases: 0, normalizedEvents: 0 });
    // Ticket sources keep their cases, raw events and customers; the Zendesk-written Jira event stays.
    expect(after).toMatchObject({ zendesk: before.zendesk, intercom: before.intercom, cases: before.cases, customers: before.customers });
    expect(after.zendesk.normalizedEvents).toBe(before.zendesk.normalizedEvents);

    const links = await prisma.caseLink.findMany({ where: { case: { organizationId: acme.organizationId } }, orderBy: { externalId: "asc" } });
    // K-1: Zendesk's official link still proves it, so it stays — with Jira's evidence stripped.
    // K-2: only Jira evidenced it, so it goes. K-3: Intercom's, untouched.
    expect(links.map((l) => l.externalId)).toEqual(["K-1", "K-3"]);
    expect(links[0]).toMatchObject({ method: "official_link", evidence: { officialLink: { id: 9 } } });
    expect(links[1]).toMatchObject({ evidence: { intercomJiraKey: { id: 3 } } });

    expect(await snapshot(other.organizationId)).toEqual(otherBefore);
  });

  it("is repeatable: cleaning an already-clean integration deletes nothing more and it stays disconnected", async () => {
    const { organizationId, zendesk } = await seedOrganization("acme");
    await disconnectViaRoute(organizationId, "zendesk");
    await db.cleanupIntegrationData(prisma, organizationId, "zendesk", ACTOR);
    const afterFirst = await snapshot(organizationId);

    const second = await db.cleanupIntegrationData(prisma, organizationId, "zendesk", ACTOR);
    expect(second).toEqual({
      status: "cleaned",
      counts: { rawEvents: 0, normalizedEvents: 0, cases: 0, caseLinksRemoved: 0, caseLinksTrimmed: 0, customerIdentities: 0, customers: 0 },
    });
    expect(await snapshot(organizationId)).toEqual(afterFirst);
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: zendesk.id } })).status).toBe("disconnected");

    // The details page still opens, now showing nothing imported.
    const { getIntegrationDetailData } = await import("../src/lib/integration-detail-data");
    expect(await getIntegrationDetailData(prisma, organizationId, "zendesk")).toMatchObject({
      disconnected: true,
      importedData: { cases: 0, rawEvents: 0 },
      backfillCompletedAt: null,
    });
  });

  it("requires the caller to name the integration and rejects an unknown provider", async () => {
    const { organizationId } = await seedOrganization("acme");
    await disconnectViaRoute(organizationId, "zendesk");
    const before = await snapshot(organizationId);

    expect((await cleanupViaRoute(organizationId, "zendesk", {})).status).toBe(400);
    expect((await cleanupViaRoute(organizationId, "zendesk", { confirm: "jira" })).status).toBe(400);
    expect((await cleanupViaRoute(organizationId, "bogus", { confirm: "bogus" })).status).toBe(404);
    expect(await snapshot(organizationId)).toEqual(before);
  });

  describe("Settings → Data", () => {
    const afterBackupOrCleanupOps = (organizationId: string) =>
      prisma.integrationDataOperation.findMany({ where: { organizationId }, orderBy: { startedAt: "asc" } });

    /** Starts a complete-data export (JSON Lines by default) of an integration. */
    const startBackup = (organizationId: string, provider: "zendesk" | "intercom" | "jira" | "linear", actor = ACTOR, format = "ndjson") =>
      db.startIntegrationExport(prisma, organizationId, provider, actor, format);

    /** Reads a started export back as its JSON Lines. */
    async function collect(exported: Parameters<typeof db.ndjsonLines>[0]) {
      const records: { type: string; data: Record<string, unknown> }[] = [];
      let raw = "";
      for await (const line of db.ndjsonLines(exported)) {
        raw += line;
        records.push(JSON.parse(line));
      }
      return { records, raw };
    }

    it("counts what each integration stores with aggregate counts, per type", async () => {
      const { organizationId, zendesk, jira } = await seedOrganization("acme");
      const summaries = await db.listIntegrationDataSummaries(prisma, organizationId);
      const byProvider = Object.fromEntries(summaries.map((s) => [s.provider, s]));

      expect(byProvider.zendesk!.counts).toEqual({
        rawEvents: 2,
        cases: 2,
        normalizedEvents: 5, // every event on its two cases, whichever source wrote it
        commitments: 1,
        evaluations: 1,
        caseLinks: 2, // K-1 and K-2; K-3 sits on Intercom's case
        customerIdentities: 4,
        other: 1, // the alert
      });
      expect(byProvider.zendesk!.total).toBe(2 + 2 + 5 + 1 + 1 + 2 + 4 + 1);
      // An engineering source owns raw events, its derived events and its links, but no cases.
      expect(byProvider.jira!.counts).toMatchObject({ rawEvents: 2, cases: 0, normalizedEvents: 3, commitments: 0, caseLinks: 3, customerIdentities: 0 });
      expect(byProvider.zendesk!.integrationId).toBe(zendesk.id);
      expect(byProvider.jira!.integrationId).toBe(jira.id);
    });

    it("lists a disconnected integration that still holds data, and drops one with nothing stored", async () => {
      const { organizationId } = await seedOrganization("acme");
      await prisma.integration.create({ data: { organizationId, provider: "linear", status: "connected", credentials: { accessToken: "x" } } });
      await disconnectViaRoute(organizationId, "zendesk");
      const { getDataPageData } = await import("../src/lib/data-page-data");

      const before = await getDataPageData(prisma, organizationId, true);
      expect(before.integrations.map((i) => i.provider).sort()).toEqual(["intercom", "jira", "zendesk"]); // linear has no records
      expect(before.integrations.find((i) => i.provider === "zendesk")).toMatchObject({ status: "disconnected" });

      await db.cleanupIntegrationData(prisma, organizationId, "zendesk", ACTOR);
      const after = await getDataPageData(prisma, organizationId, false);
      expect(after.canManage).toBe(false);
      expect(after.integrations.map((i) => i.provider).sort()).toEqual(["intercom", "jira"]);
    });

    it("backup is read-only and covers exactly what a cleanup then deletes", async () => {
      const acme = await seedOrganization("acme");
      await disconnectViaRoute(acme.organizationId, "zendesk");
      const before = await snapshot(acme.organizationId);
      const summary = (await db.listIntegrationDataSummaries(prisma, acme.organizationId)).find((s) => s.provider === "zendesk")!;

      const backup = await startBackup(acme.organizationId, "zendesk", ACTOR);
      expect(backup.status).toBe("ready");
      if (backup.status !== "ready") return;
      const { records, raw } = await collect(backup);

      // Nothing was modified or deleted, and the backup leaves the integration as it was.
      expect(await snapshot(acme.organizationId)).toEqual(before);
      expect((await prisma.integration.findUniqueOrThrow({ where: { id: acme.zendesk.id } })).status).toBe("disconnected");

      // The scope the user was shown is the scope exported.
      expect(backup.manifest.scope).toEqual(summary.counts);
      expect(records[0]).toMatchObject({ type: "manifest", data: { formatVersion: 1, provider: "zendesk", scope: summary.counts } });
      const ofType = (type: string) => records.filter((r) => r.type === type);
      expect(ofType("raw_event")).toHaveLength(summary.counts.rawEvents);
      expect(ofType("case")).toHaveLength(summary.counts.cases);
      expect(ofType("normalized_event")).toHaveLength(summary.counts.normalizedEvents);
      expect(ofType("commitment")).toHaveLength(summary.counts.commitments);
      expect(ofType("evaluation")).toHaveLength(summary.counts.evaluations);
      expect(ofType("case_link")).toHaveLength(summary.counts.caseLinks);
      expect(ofType("customer_identity")).toHaveLength(summary.counts.customerIdentities);
      expect(ofType("raw_event")[0]!.data.payload).toBeDefined(); // full payloads, not a summary

      // Credentials and the webhook secret are never exported.
      expect(raw).not.toContain("accessToken");
      expect(raw).not.toContain("acme-zendesk-secret");
      expect(ofType("integration")[0]!.data).not.toHaveProperty("credentials");
      expect(ofType("integration")[0]!.data).not.toHaveProperty("webhookSecret");

      // Cleanup then removes every record the backup held (the cases, events, commitments, evaluations and raw events).
      await db.cleanupIntegrationData(prisma, acme.organizationId, "zendesk", ACTOR);
      const stillThere = async (model: "rawEvent" | "case" | "normalizedEvent" | "commitment" | "evaluation", type: string) =>
        (prisma[model] as unknown as { count(args: unknown): Promise<number> }).count({
          where: { id: { in: ofType(type).map((r) => r.data.id as string) } },
        });
      expect(await stillThere("rawEvent", "raw_event")).toBe(0);
      expect(await stillThere("case", "case")).toBe(0);
      expect(await stillThere("normalizedEvent", "normalized_event")).toBe(0);
      expect(await stillThere("commitment", "commitment")).toBe(0);
      expect(await stillThere("evaluation", "evaluation")).toBe(0);
    });

    it("an engineering source's backup holds its own events and none of the Zendesk-written ones a cleanup keeps", async () => {
      const acme = await seedOrganization("acme");
      const backup = await startBackup(acme.organizationId, "jira", ACTOR);
      if (backup.status !== "ready") throw new Error("expected a backup");
      const { records } = await collect(backup);

      const eventIds = records.filter((r) => r.type === "normalized_event").map((r) => r.data.id as string);
      expect(eventIds).toHaveLength(3);
      await db.cleanupIntegrationData(prisma, acme.organizationId, "jira", ACTOR).catch(() => undefined); // refused while connected: nothing deleted
      expect(await prisma.normalizedEvent.count({ where: { id: { in: eventIds } } })).toBe(3);

      await disconnectViaRoute(acme.organizationId, "jira");
      await db.cleanupIntegrationData(prisma, acme.organizationId, "jira", ACTOR);
      expect(await prisma.normalizedEvent.count({ where: { id: { in: eventIds } } })).toBe(0);
      // The Jira-system event Zendesk's own producer wrote is not Jira's: it is neither in the backup nor deleted.
      const zendeskWritten = await prisma.normalizedEvent.findMany({ where: { sourceRawEvent: { integrationId: acme.zendesk.id }, system: "jira" } });
      expect(zendeskWritten).toHaveLength(1);
    });

    it("backup works for a connected integration and cleanup never creates one; both are recorded with who ran them", async () => {
      const acme = await seedOrganization("acme");
      const connectedBackup = await startBackup(acme.organizationId, "zendesk", { userId: null, email: "backup@tenant.test" });
      if (connectedBackup.status !== "ready") throw new Error("expected a backup");
      await collect(connectedBackup);

      await disconnectViaRoute(acme.organizationId, "zendesk");
      await db.cleanupIntegrationData(prisma, acme.organizationId, "zendesk", { userId: null, email: "cleanup@tenant.test" });
      // A refused cleanup attempts nothing, so records nothing.
      await db.cleanupIntegrationData(prisma, acme.organizationId, "jira", ACTOR);

      const operations = await afterBackupOrCleanupOps(acme.organizationId);
      expect(operations.map((o) => [o.kind, o.status, o.actorEmail, o.provider])).toEqual([
        ["backup", "completed", "backup@tenant.test", "zendesk"],
        ["cleanup", "completed", "cleanup@tenant.test", "zendesk"],
      ]);
      expect(operations[0]!.finishedAt).toBeInstanceOf(Date);
      expect(operations[0]!.details).toMatchObject({ scope: { rawEvents: 2, cases: 2 }, written: { raw_event: 2, case: 2 } });
      expect(operations[1]!.details).toMatchObject({ scope: { rawEvents: 2, cases: 2 }, deleted: { rawEvents: 2, cases: 2 } });
    });

    it("records a download that stops early as failed, not completed", async () => {
      const acme = await seedOrganization("acme");
      const backup = await startBackup(acme.organizationId, "zendesk", ACTOR);
      if (backup.status !== "ready") throw new Error("expected a backup");
      await backup.records.next(); // the integration record
      await backup.records.return(undefined); // the client went away

      const [operation] = await afterBackupOrCleanupOps(acme.organizationId);
      expect(operation).toMatchObject({ kind: "backup", status: "failed", error: "Download interrupted" });
    });

    it("records a download cancelled before its first record as interrupted too, not stuck in progress", async () => {
      const acme = await seedOrganization("acme");
      const backup = await startBackup(acme.organizationId, "zendesk", ACTOR, "csv");
      if (backup.status !== "ready") throw new Error("expected a backup");
      await backup.records.return(undefined); // closed without ever being read: a generator's own `finally` would not run

      const [operation] = await afterBackupOrCleanupOps(acme.organizationId);
      expect(operation).toMatchObject({ kind: "backup", status: "failed", error: "Download interrupted" });
      expect(operation!.finishedAt).toBeInstanceOf(Date);
      expect((operation!.details as { format: string }).format).toBe("csv");
    });

    it("keeps each organization's activity and counts to itself", async () => {
      const acme = await seedOrganization("acme");
      const other = await seedOrganization("other");
      const backup = await startBackup(acme.organizationId, "zendesk", ACTOR);
      if (backup.status !== "ready") throw new Error("expected a backup");
      const { records } = await collect(backup);

      // Another organization's records never appear in a backup.
      expect(records.filter((r) => r.type === "raw_event").every((r) => r.data.integrationId === acme.zendesk.id)).toBe(true);
      expect(await db.listIntegrationDataOperations(prisma, other.organizationId)).toEqual([]);
      expect(await db.listIntegrationDataOperations(prisma, acme.organizationId)).toHaveLength(1);
    });

    it("the export route streams a gzip download (JSON Lines) by default for an owner and 404s for an integration that was never connected", async () => {
      const acme = await seedOrganization("acme");
      auth.session = sessionFor(acme.organizationId);
      const { POST } = await import("../src/app/api/integrations/[provider]/export/route");
      const request = new Request("http://localhost/api", { method: "POST" });

      const response = await POST(request, { params: Promise.resolve({ provider: "zendesk" }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/gzip");
      expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="elapsed-zendesk-backup-\d{8}T\d{6}Z\.ndjson\.gz"$/);
      const { gunzipSync } = await import("node:zlib");
      const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
      const lines = text.trim().split("\n").map((line) => JSON.parse(line));
      expect(lines[0]).toMatchObject({ type: "manifest", data: { provider: "zendesk" } });
      expect(lines.filter((l) => l.type === "raw_event")).toHaveLength(2);

      expect((await POST(request, { params: Promise.resolve({ provider: "linear" }) })).status).toBe(404);
      expect((await POST(request, { params: Promise.resolve({ provider: "bogus" }) })).status).toBe(404);
    });

    describe("download formats", () => {
      async function download(organizationId: string, provider: string, format?: string) {
        auth.session = sessionFor(organizationId);
        const { POST } = await import("../src/app/api/integrations/[provider]/export/route");
        const body = new URLSearchParams(format ? { format } : {});
        return POST(new Request("http://localhost/api", { method: "POST", body }), { params: Promise.resolve({ provider }) });
      }
      const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());
      const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

      it("JSON is one document: the manifest, the integration and every collection, empty ones as []", async () => {
        const acme = await seedOrganization("acme");
        const response = await download(acme.organizationId, "zendesk", "json");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");
        expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="elapsed-zendesk-backup-\d{8}T\d{6}Z\.json"$/);
        const doc = JSON.parse(text(await bytesOf(response)));
        const summary = (await db.listIntegrationDataSummaries(prisma, acme.organizationId)).find((s) => s.provider === "zendesk")!;

        expect(doc.manifest).toMatchObject({ provider: "zendesk", scope: summary.counts });
        expect(doc.integration).toMatchObject({ provider: "zendesk" });
        expect(doc.integration).not.toHaveProperty("credentials");
        expect(doc.rawEvents).toHaveLength(summary.counts.rawEvents);
        expect(doc.cases).toHaveLength(summary.counts.cases);
        expect(doc.normalizedEvents).toHaveLength(summary.counts.normalizedEvents);
        expect(doc.commitments).toHaveLength(1);
        expect(doc.evaluations).toHaveLength(1);
        expect(doc.legSpans).toEqual([]);
        expect(doc.notificationFailures).toEqual([]);
      });

      it("CSV is a zip with one file per record type that has records, a manifest, and formulas neutralized", async () => {
        const acme = await seedOrganization("acme");
        await prisma.case.updateMany({ where: { organizationId: acme.organizationId, externalId: "acme-z-1" }, data: { subject: "=HYPERLINK(\"http://evil\")" } });
        const response = await download(acme.organizationId, "zendesk", "csv");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/zip");
        expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="elapsed-zendesk-backup-\d{8}T\d{6}Z\.zip"$/);
        const { readStoredZip } = await import("../src/lib/zip");
        const files = readStoredZip(await bytesOf(response));

        expect([...files.keys()].sort()).toEqual(
          [
            "README.txt", "manifest.json", "integration.csv", "customer_identities.csv", "customers.csv", "cases.csv", "case_links.csv",
            "normalized_events.csv", "commitments.csv", "evaluations.csv", "notifications.csv", "raw_events.csv",
          ].sort(), // no leg_spans / notification_failures / policy changes: nothing stored
        );
        const rows = (name: string) => text(files.get(name)!).trim().split("\r\n");
        expect(rows("raw_events.csv")).toHaveLength(1 + 2); // header + 2 records
        expect(rows("cases.csv")).toHaveLength(1 + 2);
        expect(rows("raw_events.csv")[0]).toContain("payload");
        expect(text(files.get("cases.csv")!)).toContain("\"'=HYPERLINK(");
        expect(text(files.get("cases.csv")!)).not.toMatch(/,=HYPERLINK/);
        expect(JSON.parse(text(files.get("manifest.json")!))).toMatchObject({ provider: "zendesk", scope: { cases: 2, rawEvents: 2 } });
        expect(text(files.get("integration.csv")!)).not.toContain("accessToken");
      });

      it("PDF is a summary report with the counts and the cases, never the records", async () => {
        const acme = await seedOrganization("acme");
        await disconnectViaRoute(acme.organizationId, "zendesk");
        const response = await download(acme.organizationId, "zendesk", "pdf");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/pdf");
        expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="elapsed-zendesk-report-\d{8}T\d{6}Z\.pdf"$/);
        const bytes = await bytesOf(response);
        expect(response.headers.get("content-length")).toBe(String(bytes.length));
        const pdf = Buffer.from(bytes).toString("latin1");
        expect(pdf.startsWith("%PDF-1.4")).toBe(true);
        expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
        for (const expected of ["Integration data report", "Disconnected", "Stored data", "(Raw records)", "acme-z-1", "SLA commitments by status", "On track"]) {
          expect(pdf, expected).toContain(expected);
        }
        expect(pdf).not.toContain("accessToken");
        expect(pdf).not.toContain('"payload"'); // a summary, not the records
      });

      it("every format is read-only and recorded with its format (the PDF is just another download, kind backup)", async () => {
        const acme = await seedOrganization("acme");
        const before = await snapshot(acme.organizationId);
        for (const format of ["ndjson", "json", "csv", "pdf"]) {
          const response = await download(acme.organizationId, "zendesk", format);
          await response.arrayBuffer(); // read to the end, so the stream finishes
        }
        expect(await snapshot(acme.organizationId)).toEqual(before);

        const operations = await afterBackupOrCleanupOps(acme.organizationId);
        expect(operations.map((o) => [o.kind, (o.details as { format: string }).format, o.status])).toEqual([
          ["backup", "ndjson", "completed"],
          ["backup", "json", "completed"],
          ["backup", "csv", "completed"],
          ["backup", "pdf", "completed"],
        ]);
      });

      it("rejects an unknown format with 400 and records nothing; no format means JSON Lines", async () => {
        const acme = await seedOrganization("acme");
        expect((await download(acme.organizationId, "zendesk", "xlsx")).status).toBe(400);
        expect(await afterBackupOrCleanupOps(acme.organizationId)).toEqual([]);

        const response = await download(acme.organizationId, "zendesk");
        expect(response.headers.get("content-type")).toBe("application/gzip");
        await response.arrayBuffer();
      });

      it("a report for an integration that was never connected is a 404 and records nothing", async () => {
        const acme = await seedOrganization("acme");
        expect((await download(acme.organizationId, "linear", "pdf")).status).toBe(404);
        expect((await download(acme.organizationId, "linear", "csv")).status).toBe(404);
        expect(await afterBackupOrCleanupOps(acme.organizationId)).toEqual([]);
      });
    });
  });
});
