/**
 * Zendesk official Jira-links correlation (`GET /api/v2/jira/links`) and its
 * interaction with the existing Jira `remote_link` correlator.
 *
 * Real Postgres, like tenant-isolation.test.ts and source-sync-evaluation.test.ts:
 * CaseLink identity lives in a real unique constraint
 * (`caseId_system_externalId`), and the whole point of this suite is proving
 * that two independent evidence producers upsert the *same* row instead of
 * racing to create two — a fake Prisma would mostly test itself. Only the two
 * correlators run for real here; Case rows are seeded directly rather than
 * going through a full Zendesk backfill/normalization pass, since correlation
 * only needs a Case to already exist by (organizationId, externalId).
 *
 * `ticket_id` is written as a STRING throughout this file (e.g. `"13"`, not
 * `13`) — that is the real Zendesk API's shape, confirmed live against a
 * connected account. A prior version of `parseJiraLinkRecord` required
 * `typeof === "number"` here, silently rejecting every real record as
 * malformed; that is the production regression this suite guards against.
 *
 * Needs a migrated Postgres at TEST_DATABASE_URL; skipped when unset. The
 * database name must contain "test", because every test truncates all tables.
 */
import type { Prisma, PrismaClient } from "@sla/db";
import { deriveLegSpans } from "@sla/core";
import { toNormalizedEventDomain } from "@sla/commitments";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { correlateJira } from "./correlate-helper";
import { correlateZendeskLinks } from "./ingest-helpers";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function assertDisposableDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL points at database "${name}". This suite truncates every table, so the name must contain "test".`,
    );
  }
}

describe.skipIf(!TEST_DATABASE_URL)("Zendesk official Jira-links correlation (real Postgres)", () => {
  let prisma: PrismaClient;
  let zendesk: typeof import("@sla/zendesk");
  let jira: typeof import("@sla/jira");
  let organizationId: string;
  let zendeskIntegrationId: string;
  let jiraIntegrationId: string;

  beforeAll(async () => {
    assertDisposableDatabase(TEST_DATABASE_URL!);
    // `@sla/db` builds its connection from DATABASE_URL at import time, so
    // the override must land before anything imports it — hence dynamic
    // imports (mirrors tenant-isolation.test.ts / source-sync-evaluation.test.ts).
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    zendesk = await import("@sla/zendesk");
    jira = await import("@sla/jira");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Acme" } });
    organizationId = organization.id;
    const zendeskIntegration = await prisma.integration.create({
      data: {
        organizationId,
        provider: "zendesk",
        credentials: { subdomain: "acme", accessToken: "token", tokenType: "bearer", scope: "read" },
      },
    });
    zendeskIntegrationId = zendeskIntegration.id;
    const jiraIntegration = await prisma.integration.create({
      data: {
        organizationId,
        provider: "jira",
        credentials: { cloudId: "cloud", siteUrl: "https://acme.atlassian.net", accessToken: "token", tokenType: "bearer" },
      },
    });
    jiraIntegrationId = jiraIntegration.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function seedCase(ticketId: string, openedAt = new Date("2026-03-01T00:00:00.000Z")): Promise<string> {
    const row = await prisma.case.create({
      data: { organizationId, system: "zendesk", sourceIntegrationId: zendeskIntegrationId, externalId: ticketId, openedAt },
    });
    return row.id;
  }

  /** Writes a `jira_link:` RawEvent exactly as `runZendeskBackfill` would, via the real mapper. */
  async function writeJiraLinkRawEvent(integrationId: string, link: Parameters<typeof zendesk.mapJiraLinkToRawEvent>[0]) {
    const input = zendesk.mapJiraLinkToRawEvent(link);
    await prisma.rawEvent.create({
      data: { integrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as Prisma.InputJsonValue },
    });
  }

  /** Writes a `remote_link:` RawEvent exactly as `runJiraBackfill` would, via the real mapper. */
  async function writeRemoteLinkRawEvent(
    integrationId: string,
    issueKey: string,
    link: Parameters<typeof jira.mapRemoteLinkToRawEvent>[1],
  ) {
    const input = jira.mapRemoteLinkToRawEvent(issueKey, link);
    await prisma.rawEvent.create({
      data: { integrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as Prisma.InputJsonValue },
    });
  }

  /**
   * Writes a `jira_link_manifest:` RawEvent exactly as `backfillJiraLinks`
   * would at the end of a full listing — the full set of link ids Zendesk
   * *currently* reports. Omitting a previously-seen id here is exactly what
   * a real Zendesk unlink looks like from this adapter's point of view: no
   * deletion event, just absence from the next full listing. `createMany`
   * with `skipDuplicates` mirrors the real backfill's own write path, so
   * writing the same content twice in one test is a harmless no-op rather
   * than a unique-constraint error.
   */
  async function writeJiraLinkManifestRawEvent(integrationId: string, linkIds: number[]) {
    const input = zendesk.mapJiraLinkManifestToRawEvent(linkIds);
    await prisma.rawEvent.createMany({
      data: [{ integrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
  }

  async function findCaseLink(caseId: string, externalId: string) {
    return prisma.caseLink.findUnique({
      where: { caseId_system_externalId: { caseId, system: "jira", externalId } },
    });
  }

  /** The same conversion `case-detail-data.ts` uses before calling `deriveLegSpans`. */
  async function legSpansFor(caseId: string) {
    const rows = await prisma.normalizedEvent.findMany({ where: { caseId } });
    return deriveLegSpans(rows.map(toNormalizedEventDomain), {
      caseOpenedAt: (await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).openedAt.toISOString(),
    }).spans;
  }

  async function currentLegFor(caseId: string): Promise<string> {
    const spans = await legSpansFor(caseId);
    return spans[spans.length - 1]?.leg ?? "unknown";
  }

  /** A `case_created` NormalizedEvent, like a real Zendesk normalization would write — establishes the support leg before any engineering-side signal exists. */
  async function seedCaseCreatedEvent(caseId: string, occurredAt: string) {
    const rawEvent = await prisma.rawEvent.create({
      data: { integrationId: zendeskIntegrationId, providerEventId: `ticket:${caseId}:seed`, sourceHash: "seed", payload: {} },
    });
    await prisma.normalizedEvent.create({
      data: { caseId, sourceRawEventId: rawEvent.id, type: "case_created", occurredAt: new Date(occurredAt), actor: "customer", system: "zendesk", sourceRole: "ticket_source", toState: "new" },
    });
  }

  it("1. reproduces the exact live production record (ticket 13 -> KAN-42, ticket_id as a string) and correlates it", async () => {
    const caseId = await seedCase("13");
    // Exact shape observed live against a connected Zendesk account for a
    // real ticket (ids/subdomain redacted) — this is the production
    // regression, not a synthetic fixture.
    await writeJiraLinkRawEvent(zendeskIntegrationId, {
      id: 81003289,
      ticket_id: "13",
      issue_id: "10745",
      issue_key: "KAN-42",
    });

    const result = await correlateZendeskLinks(prisma, zendeskIntegrationId);

    expect(result).toMatchObject({ officialLinksEvaluated: 1, caseLinksCreated: 1, unmatchedInvalidRecord: 0, unmatchedNoCase: 0 });
    const link = await findCaseLink(caseId, "KAN-42");
    expect(link).toMatchObject({ method: "official_link", confidence: "certain" });
    expect((link!.evidence as { officialLink?: unknown }).officialLink).toMatchObject({ ticket_id: "13", issue_key: "KAN-42" });
  });

  it("2. creates a certain/official_link CaseLink from ticket_id + issue_key", async () => {
    const caseId = await seedCase("123");
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "123", issue_key: "KAN-38" });

    const result = await correlateZendeskLinks(prisma, zendeskIntegrationId);

    expect(result).toMatchObject({ officialLinksEvaluated: 1, caseLinksCreated: 1, unmatchedInvalidRecord: 0, unmatchedNoCase: 0 });
    const link = await findCaseLink(caseId, "KAN-38");
    expect(link).toMatchObject({ method: "official_link", confidence: "certain" });
    expect((link!.evidence as { officialLink?: unknown }).officialLink).toMatchObject({ ticket_id: "123", issue_key: "KAN-38" });

    const linkedEvents = await prisma.normalizedEvent.findMany({ where: { caseId, type: "issue_linked" } });
    expect(linkedEvents).toHaveLength(1);
  });

  it("3. multiple official links produce independent CaseLinks", async () => {
    const case1 = await seedCase("123");
    const case2 = await seedCase("124");
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "123", issue_key: "KAN-38" });
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 2, ticket_id: "124", issue_key: "KAN-39" });

    const result = await correlateZendeskLinks(prisma, zendeskIntegrationId);

    expect(result.caseLinksCreated).toBe(2);
    expect(await findCaseLink(case1, "KAN-38")).not.toBeNull();
    expect(await findCaseLink(case2, "KAN-39")).not.toBeNull();
  });

  it("4. repeated/duplicate official-link records collapse into one CaseLink, idempotently", async () => {
    const caseId = await seedCase("123");
    // Two distinct Zendesk link ids (a redundant registry entry), same ticket/issue pair.
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "123", issue_key: "KAN-38" });
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 2, ticket_id: "123", issue_key: "KAN-38" });

    const result = await correlateZendeskLinks(prisma, zendeskIntegrationId);
    expect(result.caseLinksCreated).toBe(1);
    expect(await prisma.caseLink.count({ where: { caseId, system: "jira", externalId: "KAN-38" } })).toBe(1);

    // Re-running (e.g. the next poll) against the same RawEvents is idempotent.
    const rerun = await correlateZendeskLinks(prisma, zendeskIntegrationId);
    expect(rerun.caseLinksCreated).toBe(0);
    expect(await prisma.caseLink.count({ where: { caseId, system: "jira", externalId: "KAN-38" } })).toBe(1);
    expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_linked" } })).toBe(1);
  });

  it("5. official link + remote link converge on one CaseLink, evidence from both, regardless of order", async () => {
    async function scenario(ticketId: string, issueKey: string, officialFirst: boolean) {
      const caseId = await seedCase(ticketId);
      const officialLink = { id: Number(ticketId), ticket_id: ticketId, issue_key: issueKey };
      const remoteLink = { id: Number(ticketId), self: `https://api.atlassian.com/.../remotelink/${ticketId}`, object: { url: `https://acme.zendesk.com/agent/tickets/${ticketId}`, title: `Ticket ${ticketId}` } };
      await writeJiraLinkRawEvent(zendeskIntegrationId, officialLink);
      await writeRemoteLinkRawEvent(jiraIntegrationId, issueKey, remoteLink);

      if (officialFirst) {
        await correlateZendeskLinks(prisma, zendeskIntegrationId);
        await correlateJira(prisma, jiraIntegrationId);
      } else {
        await correlateJira(prisma, jiraIntegrationId);
        await correlateZendeskLinks(prisma, zendeskIntegrationId);
      }

      expect(await prisma.caseLink.count({ where: { caseId, system: "jira", externalId: issueKey } })).toBe(1);
      const link = await findCaseLink(caseId, issueKey);
      expect(link).toMatchObject({ method: "official_link", confidence: "certain" });
      const evidence = link!.evidence as { officialLink?: unknown; remoteLink?: unknown };
      expect(evidence.officialLink).toMatchObject({ issue_key: issueKey });
      expect(evidence.remoteLink).toMatchObject({ object: { url: expect.stringContaining(ticketId) } });
      expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_linked" } })).toBe(1);
    }

    await scenario("201", "KAN-41", true);
    await scenario("202", "KAN-42", false);
  });

  it("6. a stale-subdomain remote link alone never establishes the relationship", async () => {
    const caseId = await seedCase("127");
    await writeRemoteLinkRawEvent(jiraIntegrationId, "KAN-43", {
      id: 1,
      self: "https://api.atlassian.com/.../remotelink/1",
      object: { url: "https://old-subdomain.zendesk.com/agent/tickets/127", title: "Ticket 127" },
    });

    const result = await correlateJira(prisma, jiraIntegrationId);

    expect(result).toMatchObject({ caseLinksCreated: 0, unmatchedUnrecognizedUrl: 1 });
    expect(await prisma.caseLink.count({ where: { caseId } })).toBe(0);
  });

  it("7. official link + stale remote link: the CaseLink still exists via official_link, the stale link creates nothing extra", async () => {
    const caseId = await seedCase("128");
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "128", issue_key: "KAN-44" });
    await writeRemoteLinkRawEvent(jiraIntegrationId, "KAN-44", {
      id: 1,
      self: "https://api.atlassian.com/.../remotelink/1",
      object: { url: "https://old-subdomain.zendesk.com/agent/tickets/128", title: "Ticket 128" },
    });

    const officialResult = await correlateZendeskLinks(prisma, zendeskIntegrationId);
    const remoteResult = await correlateJira(prisma, jiraIntegrationId);

    expect(officialResult.caseLinksCreated).toBe(1);
    expect(remoteResult).toMatchObject({ caseLinksCreated: 0, unmatchedUnrecognizedUrl: 1 });

    const links = await prisma.caseLink.findMany({ where: { caseId, system: "jira" } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ externalId: "KAN-44", method: "official_link", confidence: "certain" });
    expect((links[0]!.evidence as { officialLink?: unknown }).officialLink).toMatchObject({ issue_key: "KAN-44" });
  });

  it("8. a malformed official-link record (missing/invalid ticket_id or issue_key) never produces a CaseLink", async () => {
    await seedCase("129");
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "129" } as never); // missing issue_key
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 2, ticket_id: "129", issue_key: "" }); // blank issue_key
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 3, ticket_id: "not-a-ticket-id", issue_key: "KAN-45" }); // non-numeric ticket_id
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 4, ticket_id: null, issue_key: "KAN-46" } as never); // ticket_id not a string/number at all

    const result = await correlateZendeskLinks(prisma, zendeskIntegrationId);

    expect(result).toMatchObject({ officialLinksEvaluated: 4, unmatchedInvalidRecord: 4, caseLinksCreated: 0 });
    expect(await prisma.caseLink.count({ where: { case: { organizationId } } })).toBe(0);
  });

  it("9. official links from one Zendesk connection never create CaseLinks for another organization", async () => {
    const orgB = await prisma.organization.create({ data: { name: "Bravo" } });
    const zendeskB = await prisma.integration.create({
      data: { organizationId: orgB.id, provider: "zendesk", credentials: { subdomain: "bravo", accessToken: "t", tokenType: "bearer", scope: "read" } },
    });
    // Same externalId as org A's case, deliberately, to prove no cross-tenant collision.
    const caseA = await seedCase("123");
    const caseB = await prisma.case.create({
      data: { organizationId: orgB.id, system: "zendesk", sourceIntegrationId: zendeskB.id, externalId: "123", openedAt: new Date("2026-03-01T00:00:00.000Z") },
    });

    // Only org A's Zendesk integration has an official-link RawEvent.
    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "123", issue_key: "KAN-38" });

    const resultA = await correlateZendeskLinks(prisma, zendeskIntegrationId);
    const resultB = await correlateZendeskLinks(prisma, zendeskB.id);

    expect(resultA.caseLinksCreated).toBe(1);
    expect(resultB).toMatchObject({ officialLinksEvaluated: 0, caseLinksCreated: 0 });
    expect(await findCaseLink(caseA, "KAN-38")).not.toBeNull();
    expect(await prisma.caseLink.count({ where: { caseId: caseB.id } })).toBe(0);
  });

  it("10. the engineering leg starts once official-link correlation lands, from no other event than issue_linked", async () => {
    const caseId = await seedCase("13");
    expect(await currentLegFor(caseId)).toBe("unknown"); // no events yet at all

    await seedCaseCreatedEvent(caseId, "2026-03-01T00:00:00.000Z");
    expect(await currentLegFor(caseId)).toBe("support");

    await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 81003289, ticket_id: "13", issue_id: "10745", issue_key: "KAN-42" });
    const result = await correlateZendeskLinks(prisma, zendeskIntegrationId);
    expect(result.caseLinksCreated).toBe(1);

    expect(await currentLegFor(caseId)).toBe("engineering");
  });

  describe("unlink lifecycle", () => {
    it("11. unlink preserves history: CaseLink row, evidence, issue_linked event, and historical engineering time all remain — only the active relationship ends", async () => {
      const caseId = await seedCase("13");
      await seedCaseCreatedEvent(caseId, "2026-03-01T00:00:00.000Z");

      // Zendesk currently reports link id 1 (ticket 13 <-> KAN-40).
      await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "13", issue_key: "KAN-40" });
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, [1]);
      const firstRun = await correlateZendeskLinks(prisma, zendeskIntegrationId);
      expect(firstRun.caseLinksCreated).toBe(1);
      expect(await currentLegFor(caseId)).toBe("engineering");

      const activeLink = await findCaseLink(caseId, "KAN-40");
      expect(activeLink).toMatchObject({ unlinkedAt: null, method: "official_link" });

      // The user clicks Unlink in Zendesk: the next full listing no longer
      // reports link id 1 at all (no deletion event — just absence).
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, []);
      const secondRun = await correlateZendeskLinks(prisma, zendeskIntegrationId);
      expect(secondRun.caseLinksUnlinked).toBe(1);

      // --- Current relationship: inactive ---
      const unlinkedLink = await findCaseLink(caseId, "KAN-40");
      expect(unlinkedLink!.unlinkedAt).not.toBeNull();
      expect(await currentLegFor(caseId)).toBe("support"); // engineering ended, not erased

      // --- Historical data: all still present, nothing deleted ---
      expect(unlinkedLink!.method).toBe("official_link"); // history of how it was established
      expect(unlinkedLink!.confidence).toBe("certain");
      expect((unlinkedLink!.evidence as { officialLink?: unknown }).officialLink).toMatchObject({ issue_key: "KAN-40" });
      expect(
        await prisma.rawEvent.count({ where: { integrationId: zendeskIntegrationId, providerEventId: { startsWith: "jira_link:1:" } } }),
      ).toBe(1); // the raw evidence itself is never deleted
      expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_linked" } })).toBe(1);
      expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_unlinked" } })).toBe(1);

      const spans = await legSpansFor(caseId);
      const engineeringSpan = spans.find((s) => s.leg === "engineering");
      expect(engineeringSpan).toBeDefined(); // historical engineering span not erased
      expect(engineeringSpan!.endedAt).not.toBeNull(); // closed at the unlink, not open-ended
      expect(spans[spans.length - 1]!.leg).toBe("support"); // and a new support span opened after it
    });

    it("12. unlink then a different Jira issue: the old issue stays historical/unlinked, the new one is active — no collapsing", async () => {
      const caseId = await seedCase("13");
      await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "13", issue_key: "KAN-40" });
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, [1]);
      await correlateZendeskLinks(prisma, zendeskIntegrationId);

      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, []); // unlink KAN-40
      await correlateZendeskLinks(prisma, zendeskIntegrationId);

      // Ticket 13 is now linked to a different issue, KAN-41.
      await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 2, ticket_id: "13", issue_key: "KAN-41" });
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, [2]);
      const result = await correlateZendeskLinks(prisma, zendeskIntegrationId);
      expect(result.caseLinksCreated).toBe(1); // a genuinely new row, not a mutation of KAN-40's

      const oldLink = await findCaseLink(caseId, "KAN-40");
      const newLink = await findCaseLink(caseId, "KAN-41");
      expect(oldLink!.unlinkedAt).not.toBeNull();
      expect(newLink!.unlinkedAt).toBeNull();
      expect(await prisma.caseLink.count({ where: { caseId, system: "jira" } })).toBe(2); // both rows coexist
    });

    it("13. unlink then re-link the same issue is idempotent: one row, unlinkedAt clears, a fresh issue_linked event lands at the re-link time", async () => {
      const caseId = await seedCase("13");

      // Zendesk assigns a new registry id (2) to the re-established link —
      // the common case: the old link row was deleted, a new one created.
      await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "13", issue_key: "KAN-40" });
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, [1]);
      await correlateZendeskLinks(prisma, zendeskIntegrationId);

      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, []);
      await correlateZendeskLinks(prisma, zendeskIntegrationId);

      await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 2, ticket_id: "13", issue_key: "KAN-40" });
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, [2]);
      const relinkResult = await correlateZendeskLinks(prisma, zendeskIntegrationId);
      expect(relinkResult.caseLinksCreated).toBe(0);
      expect(relinkResult.caseLinksReactivated).toBe(1);

      expect(await prisma.caseLink.count({ where: { caseId, system: "jira", externalId: "KAN-40" } })).toBe(1); // no duplicate row
      const relinked = await findCaseLink(caseId, "KAN-40");
      expect(relinked!.unlinkedAt).toBeNull();
      expect((relinked!.evidence as { officialLink?: { id?: number } }).officialLink?.id).toBe(2);
      expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_linked" } })).toBe(2); // original + re-link
      expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_unlinked" } })).toBe(1);

      // Re-running with nothing new changed is a pure no-op — no further duplication.
      const rerun = await correlateZendeskLinks(prisma, zendeskIntegrationId);
      expect(rerun.caseLinksCreated).toBe(0);
      expect(rerun.caseLinksReactivated).toBe(0);
      expect(rerun.caseLinksUnlinked).toBe(0);
      expect(await prisma.caseLink.count({ where: { caseId, system: "jira", externalId: "KAN-40" } })).toBe(1);
    });

    it("13b. unlink then re-link with the SAME Zendesk link id still produces exactly one fresh issue_linked event, timestamped at the re-link", async () => {
      const caseId = await seedCase("13");
      await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "13", issue_key: "KAN-40" });
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, [1]);
      await correlateZendeskLinks(prisma, zendeskIntegrationId);

      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, []);
      await correlateZendeskLinks(prisma, zendeskIntegrationId);

      // Zendesk reuses the same link id 1 on re-link — a fresh snapshot with
      // its own `updated_at`, distinct content from the original so it lands
      // as its own RawEvent rather than colliding on the content hash.
      await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "13", issue_key: "KAN-40", updated_at: "2026-03-02T00:00:00.000Z" });
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, [1]);
      const relinkResult = await correlateZendeskLinks(prisma, zendeskIntegrationId);
      expect(relinkResult.caseLinksReactivated).toBe(1);

      const relinked = await findCaseLink(caseId, "KAN-40");
      expect(relinked!.unlinkedAt).toBeNull();
      const linkEvents = await prisma.normalizedEvent.findMany({ where: { caseId, type: "issue_linked" }, orderBy: { occurredAt: "asc" } });
      expect(linkEvents).toHaveLength(2);
      // The re-link's event must not reuse the original link's timestamp.
      expect(linkEvents[1]!.occurredAt.getTime()).toBeGreaterThan(linkEvents[0]!.occurredAt.getTime());
    });

    it("14. an independently valid remote_link is not destroyed merely because the official link disappeared", async () => {
      const caseId = await seedCase("13");
      await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "13", issue_key: "KAN-40" });
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, [1]);
      await correlateZendeskLinks(prisma, zendeskIntegrationId);

      // A valid (non-stale-hostname) Jira remote link independently confirms the same relationship.
      await writeRemoteLinkRawEvent(jiraIntegrationId, "KAN-40", {
        id: 1,
        self: "https://api.atlassian.com/.../remotelink/1",
        object: { url: "https://acme.zendesk.com/agent/tickets/13", title: "Ticket 13" },
      });
      await correlateJira(prisma, jiraIntegrationId);
      expect((await findCaseLink(caseId, "KAN-40"))!.evidence).toMatchObject({ remoteLink: expect.anything(), officialLink: expect.anything() });

      // The official link disappears from Zendesk's registry...
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, []);
      const sweepResult = await correlateZendeskLinks(prisma, zendeskIntegrationId);

      // ...but the CaseLink stays active: remote_link still proves the relationship.
      expect(sweepResult.caseLinksUnlinked).toBe(0);
      const link = await findCaseLink(caseId, "KAN-40");
      expect(link!.unlinkedAt).toBeNull();
      // The stale official-link evidence is still kept, not deleted — it's history.
      expect((link!.evidence as { officialLink?: unknown }).officialLink).toMatchObject({ issue_key: "KAN-40" });
    });

    it("15. tenant isolation: an unlink sweep in one organization never marks another organization's CaseLink unlinked", async () => {
      const orgB = await prisma.organization.create({ data: { name: "Bravo" } });
      const zendeskB = await prisma.integration.create({
        data: { organizationId: orgB.id, provider: "zendesk", credentials: { subdomain: "bravo", accessToken: "t", tokenType: "bearer", scope: "read" } },
      });
      const caseA = await seedCase("13");
      const caseB = await prisma.case.create({
        data: { organizationId: orgB.id, system: "zendesk", sourceIntegrationId: zendeskB.id, externalId: "13", openedAt: new Date("2026-03-01T00:00:00.000Z") },
      });

      // Both organizations independently link the same-shaped (ticket 13, KAN-40) pair.
      await writeJiraLinkRawEvent(zendeskIntegrationId, { id: 1, ticket_id: "13", issue_key: "KAN-40" });
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, [1]);
      await correlateZendeskLinks(prisma, zendeskIntegrationId);

      await writeJiraLinkRawEvent(zendeskB.id, { id: 1, ticket_id: "13", issue_key: "KAN-40" });
      await writeJiraLinkManifestRawEvent(zendeskB.id, [1]);
      await correlateZendeskLinks(prisma, zendeskB.id);

      // Only org A's ticket gets unlinked.
      await writeJiraLinkManifestRawEvent(zendeskIntegrationId, []);
      const resultA = await correlateZendeskLinks(prisma, zendeskIntegrationId);
      expect(resultA.caseLinksUnlinked).toBe(1);

      const linkA = await prisma.caseLink.findUnique({ where: { caseId_system_externalId: { caseId: caseA, system: "jira", externalId: "KAN-40" } } });
      const linkB = await prisma.caseLink.findUnique({ where: { caseId_system_externalId: { caseId: caseB.id, system: "jira", externalId: "KAN-40" } } });
      expect(linkA!.unlinkedAt).not.toBeNull();
      expect(linkB!.unlinkedAt).toBeNull(); // untouched by org A's sweep
    });
  });
});
