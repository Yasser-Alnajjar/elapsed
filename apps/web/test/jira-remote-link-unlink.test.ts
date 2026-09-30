/**
 * Roadmap task 2.6 — the genuinely-missing Jira work, audited against
 * commit 0125f27 and `official-link-correlation.test.ts`'s existing 16
 * tests (which this suite deliberately does NOT re-cover: unlink history
 * preservation, issue-switching, re-link idempotency, remote-link
 * independence, and tenant isolation for the *Zendesk-side* sweep are
 * already pinned there):
 *
 *  (a) `jira:issue_deleted` now unlinks via `markCaseLinksUnlinkedForIssue`.
 *  (b) The 404-on-refetch path in the webhook route reuses the same
 *      function — proven here by calling it directly, since it's the exact
 *      same call the route's catch block makes.
 *  (c) `runJiraCorrelation`'s new manifest-diff sweep (`remote_link_manifest:`)
 *      detects a Jira-side remote-link removal, mirroring the Zendesk-side
 *      `sweepUnlinkedOfficialLinks`.
 *  (d) The sticky-exemption bug this exposed: a CaseLink whose official link
 *      AND remote link are both eventually removed (in either order, not
 *      necessarily the same run) must eventually unlink, not stay linked
 *      forever on stale `!= null` evidence.
 *
 * Real Postgres, like official-link-correlation.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { Prisma, PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { correlateJira } from "./correlate-helper";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function assertDisposableDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL points at database "${name}". This suite truncates every table, so the name must contain "test".`,
    );
  }
}

describe.skipIf(!TEST_DATABASE_URL)("Jira remote-link unlink lifecycle (real Postgres)", () => {
  let prisma: PrismaClient;
  let zendesk: typeof import("@sla/zendesk");
  let jira: typeof import("@sla/jira");
  let organizationId: string;
  let zendeskIntegrationId: string;
  let jiraIntegrationId: string;

  beforeAll(async () => {
    assertDisposableDatabase(TEST_DATABASE_URL!);
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

  async function seedCase(ticketId: string): Promise<string> {
    const row = await prisma.case.create({
      data: { organizationId, externalId: ticketId, openedAt: new Date("2026-03-01T00:00:00.000Z") },
    });
    return row.id;
  }

  async function writeJiraLinkRawEvent(link: Parameters<typeof zendesk.mapJiraLinkToRawEvent>[0]) {
    const input = zendesk.mapJiraLinkToRawEvent(link);
    await prisma.rawEvent.create({
      data: { integrationId: zendeskIntegrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as Prisma.InputJsonValue },
    });
  }

  async function writeJiraLinkManifestRawEvent(linkIds: number[]) {
    const input = zendesk.mapJiraLinkManifestToRawEvent(linkIds);
    await prisma.rawEvent.createMany({
      data: [{ integrationId: zendeskIntegrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
  }

  async function writeRemoteLinkRawEvent(issueKey: string, link: Parameters<typeof jira.mapRemoteLinkToRawEvent>[1]) {
    const input = jira.mapRemoteLinkToRawEvent(issueKey, link);
    await prisma.rawEvent.create({
      data: { integrationId: jiraIntegrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as Prisma.InputJsonValue },
    });
  }

  async function writeRemoteLinkManifestRawEvent(issueKey: string, linkIds: number[]) {
    const input = jira.mapRemoteLinkManifestToRawEvent(issueKey, linkIds);
    await prisma.rawEvent.createMany({
      data: [{ integrationId: jiraIntegrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
  }

  async function findCaseLink(caseId: string, externalId: string) {
    return prisma.caseLink.findUnique({
      where: { caseId_system_externalId: { caseId, system: "jira", externalId } },
    });
  }

  function remoteLink(id: number, ticketId: string) {
    return { id, self: `https://api.atlassian.com/.../remotelink/${id}`, object: { url: `https://acme.zendesk.com/agent/tickets/${ticketId}`, title: `Ticket ${ticketId}` } };
  }

  it("a remote link's removal unlinks a remote-only CaseLink", async () => {
    const caseId = await seedCase("1");
    await writeRemoteLinkRawEvent("KAN-1", remoteLink(1, "1"));
    await writeRemoteLinkManifestRawEvent("KAN-1", [1]);
    const firstRun = await correlateJira(prisma, jiraIntegrationId);
    expect(firstRun.caseLinksCreated).toBe(1);
    expect((await findCaseLink(caseId, "KAN-1"))!.unlinkedAt).toBeNull();

    // The remote link disappears from Jira's per-issue listing...
    await writeRemoteLinkManifestRawEvent("KAN-1", []);
    const sweepRun = await correlateJira(prisma, jiraIntegrationId);

    expect(sweepRun.caseLinksUnlinked).toBe(1);
    const link = await findCaseLink(caseId, "KAN-1");
    expect(link!.unlinkedAt).not.toBeNull();
    expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_unlinked" } })).toBe(1);
  });

  it("an official link still present exempts a CaseLink from unlinking when only the remote link disappears", async () => {
    const caseId = await seedCase("2");
    await writeJiraLinkRawEvent({ id: 1, ticket_id: "2", issue_key: "KAN-2" });
    await writeJiraLinkManifestRawEvent([1]);
    await zendesk.runZendeskJiraLinkCorrelation(prisma, zendeskIntegrationId);

    await writeRemoteLinkRawEvent("KAN-2", remoteLink(1, "2"));
    await writeRemoteLinkManifestRawEvent("KAN-2", [1]);
    await correlateJira(prisma, jiraIntegrationId);
    expect((await findCaseLink(caseId, "KAN-2"))!.evidence).toMatchObject({ officialLink: expect.anything(), remoteLink: expect.anything() });

    // Only the remote link disappears — the official link still proves it.
    await writeRemoteLinkManifestRawEvent("KAN-2", []);
    const sweepRun = await correlateJira(prisma, jiraIntegrationId);

    expect(sweepRun.caseLinksUnlinked).toBe(0);
    const link = await findCaseLink(caseId, "KAN-2");
    expect(link!.unlinkedAt).toBeNull();
    expect((link!.evidence as { remoteLinkRemovedAt?: unknown }).remoteLinkRemovedAt).toBeDefined();
  });

  it("jira:issue_deleted (via markCaseLinksUnlinkedForIssue) unlinks every active CaseLink for that issue", async () => {
    const caseId = await seedCase("3");
    await writeRemoteLinkRawEvent("KAN-3", remoteLink(1, "3"));
    await writeRemoteLinkManifestRawEvent("KAN-3", [1]);
    await correlateJira(prisma, jiraIntegrationId);
    expect((await findCaseLink(caseId, "KAN-3"))!.unlinkedAt).toBeNull();

    // The webhook route calls this exact function both for an explicit
    // jira:issue_deleted event and for a 404 on the targeted refetch (the
    // same fact from two different angles) — proven here directly.
    await jira.markCaseLinksUnlinkedForIssue(prisma, jiraIntegrationId, "KAN-3");

    const link = await findCaseLink(caseId, "KAN-3");
    expect(link!.unlinkedAt).not.toBeNull();
    expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_unlinked" } })).toBe(1);

    // A redelivered/duplicate event (or a second 404) is a no-op, not a
    // second unlinkedAt write or a second event.
    await jira.markCaseLinksUnlinkedForIssue(prisma, jiraIntegrationId, "KAN-3");
    expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_unlinked" } })).toBe(1);
  });

  it("both links eventually removed — official first, then remote — finally unlinks (the sticky-exemption regression)", async () => {
    const caseId = await seedCase("4");
    await writeJiraLinkRawEvent({ id: 1, ticket_id: "4", issue_key: "KAN-4" });
    await writeJiraLinkManifestRawEvent([1]);
    await zendesk.runZendeskJiraLinkCorrelation(prisma, zendeskIntegrationId);
    await writeRemoteLinkRawEvent("KAN-4", remoteLink(1, "4"));
    await writeRemoteLinkManifestRawEvent("KAN-4", [1]);
    await correlateJira(prisma, jiraIntegrationId);
    expect((await findCaseLink(caseId, "KAN-4"))!.unlinkedAt).toBeNull();

    // The official link disappears first — exempted, since the remote link still proves it.
    await writeJiraLinkManifestRawEvent([]);
    const zendeskSweep = await zendesk.runZendeskJiraLinkCorrelation(prisma, zendeskIntegrationId);
    expect(zendeskSweep.caseLinksUnlinked).toBe(0);
    expect((await findCaseLink(caseId, "KAN-4"))!.unlinkedAt).toBeNull();

    // Now the remote link disappears too — without the fix, this would stay
    // exempted forever on stale `officialLink != null` evidence.
    await writeRemoteLinkManifestRawEvent("KAN-4", []);
    const jiraSweep = await correlateJira(prisma, jiraIntegrationId);

    expect(jiraSweep.caseLinksUnlinked).toBe(1);
    expect((await findCaseLink(caseId, "KAN-4"))!.unlinkedAt).not.toBeNull();
  });

  it("both links eventually removed — remote first, then official — finally unlinks (the same regression, the other order)", async () => {
    const caseId = await seedCase("5");
    await writeJiraLinkRawEvent({ id: 1, ticket_id: "5", issue_key: "KAN-5" });
    await writeJiraLinkManifestRawEvent([1]);
    await zendesk.runZendeskJiraLinkCorrelation(prisma, zendeskIntegrationId);
    await writeRemoteLinkRawEvent("KAN-5", remoteLink(1, "5"));
    await writeRemoteLinkManifestRawEvent("KAN-5", [1]);
    await correlateJira(prisma, jiraIntegrationId);

    // The remote link disappears first — exempted, since the official link still proves it.
    await writeRemoteLinkManifestRawEvent("KAN-5", []);
    const jiraSweep = await correlateJira(prisma, jiraIntegrationId);
    expect(jiraSweep.caseLinksUnlinked).toBe(0);
    expect((await findCaseLink(caseId, "KAN-5"))!.unlinkedAt).toBeNull();

    // Now the official link disappears too.
    await writeJiraLinkManifestRawEvent([]);
    const zendeskSweep = await zendesk.runZendeskJiraLinkCorrelation(prisma, zendeskIntegrationId);

    expect(zendeskSweep.caseLinksUnlinked).toBe(1);
    expect((await findCaseLink(caseId, "KAN-5"))!.unlinkedAt).not.toBeNull();
  });

  it("re-linking after a remote-link removal reactivates the same CaseLink", async () => {
    const caseId = await seedCase("6");
    await writeRemoteLinkRawEvent("KAN-6", remoteLink(1, "6"));
    await writeRemoteLinkManifestRawEvent("KAN-6", [1]);
    await correlateJira(prisma, jiraIntegrationId);

    await writeRemoteLinkManifestRawEvent("KAN-6", []);
    await correlateJira(prisma, jiraIntegrationId);
    expect((await findCaseLink(caseId, "KAN-6"))!.unlinkedAt).not.toBeNull();

    // The link reappears in a fresh listing.
    await writeRemoteLinkManifestRawEvent("KAN-6", [1]);
    const relinkRun = await correlateJira(prisma, jiraIntegrationId);

    expect(relinkRun.caseLinksReactivated).toBe(1);
    const link = await findCaseLink(caseId, "KAN-6");
    expect(link!.unlinkedAt).toBeNull();
    expect(await prisma.normalizedEvent.count({ where: { caseId, type: "issue_linked" } })).toBe(2); // original + re-link
  });

  it("tenant isolation: a remote-link sweep in one organization never marks another organization's CaseLink unlinked", async () => {
    const orgB = await prisma.organization.create({ data: { name: "Bravo" } });
    // runJiraCorrelation resolves the Zendesk ticket URL against this org's
    // own connected subdomain — without it, org B's correlation bails out
    // before ever creating a CaseLink, and this test would be proving
    // nothing.
    await prisma.integration.create({
      data: { organizationId: orgB.id, provider: "zendesk", credentials: { subdomain: "acme", accessToken: "token", tokenType: "bearer", scope: "read" } },
    });
    const jiraB = await prisma.integration.create({
      data: { organizationId: orgB.id, provider: "jira", credentials: { cloudId: "cloud-b", siteUrl: "https://bravo.atlassian.net", accessToken: "t", tokenType: "bearer" } },
    });
    const caseA = await seedCase("7");
    const caseB = await prisma.case.create({
      data: { organizationId: orgB.id, externalId: "7", openedAt: new Date("2026-03-01T00:00:00.000Z") },
    });

    // Both organizations independently link the same-shaped (issue KAN-7, ticket 7) pair.
    await writeRemoteLinkRawEvent("KAN-7", remoteLink(1, "7"));
    await writeRemoteLinkManifestRawEvent("KAN-7", [1]);
    await correlateJira(prisma, jiraIntegrationId);

    const linkInputB = jira.mapRemoteLinkToRawEvent("KAN-7", remoteLink(1, "7"));
    await prisma.rawEvent.create({
      data: { integrationId: jiraB.id, providerEventId: linkInputB.providerEventId, sourceHash: linkInputB.sourceHash, payload: linkInputB.payload as Prisma.InputJsonValue },
    });
    const manifestInputB = jira.mapRemoteLinkManifestToRawEvent("KAN-7", [1]);
    await prisma.rawEvent.create({
      data: { integrationId: jiraB.id, providerEventId: manifestInputB.providerEventId, sourceHash: manifestInputB.sourceHash, payload: manifestInputB.payload as Prisma.InputJsonValue },
    });
    await correlateJira(prisma, jiraB.id);

    // Only org A's issue gets its remote link removed.
    await writeRemoteLinkManifestRawEvent("KAN-7", []);
    const resultA = await correlateJira(prisma, jiraIntegrationId);
    expect(resultA.caseLinksUnlinked).toBe(1);

    const linkA = await prisma.caseLink.findUnique({ where: { caseId_system_externalId: { caseId: caseA, system: "jira", externalId: "KAN-7" } } });
    const linkB = await prisma.caseLink.findUnique({ where: { caseId_system_externalId: { caseId: caseB.id, system: "jira", externalId: "KAN-7" } } });
    expect(linkA!.unlinkedAt).not.toBeNull();
    expect(linkB!.unlinkedAt).toBeNull(); // untouched by org A's sweep
  });
});
