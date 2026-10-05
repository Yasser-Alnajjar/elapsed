/**
 * Roadmap task 2.4: a Jira webhook re-processes only the affected issue,
 * not every issue the integration has ever seen. `runJiraNormalization`'s
 * new `{ issueKeys }` scope and `runJiraCorrelation`'s new `{ issueKey }`
 * scope (packages/jira/src/{normalize,correlate}.ts) are what the webhook
 * route now passes — this proves a scoped run for one issue never touches
 * another issue's Case, even when that other issue also has a newer,
 * unprocessed changelog entry sitting in the same integration.
 *
 * Real Postgres, like official-link-correlation.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sourceIntegration } from "./source-integration";
import { normalizeJira } from "./ingest-helpers";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Jira normalization issue scoping (real Postgres)", () => {
  let prisma: PrismaClient;
  let jira: typeof import("@sla/jira");

  let organizationId: string;
  let integrationId: string;
  let caseAId: string;
  let caseBId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    jira = await import("@sla/jira");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Scope Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: {
        organizationId,
        provider: "jira",
        credentials: { cloudId: "cloud", siteUrl: "https://acme.atlassian.net", accessToken: "token", tokenType: "bearer" },
      },
    });
    integrationId = integration.id;

    const caseA = await prisma.case.create({
      data: { organizationId, externalId: "ticket-a", system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), subject: "A", openedAt: new Date("2026-03-01") },
    });
    caseAId = caseA.id;
    const caseB = await prisma.case.create({
      data: { organizationId, externalId: "ticket-b", system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), subject: "B", openedAt: new Date("2026-03-01") },
    });
    caseBId = caseB.id;

    await prisma.caseLink.create({
      data: { caseId: caseAId, system: "jira", externalId: "PROJ-1", method: "official_link", confidence: "certain" },
    });
    await prisma.caseLink.create({
      data: { caseId: caseBId, system: "jira", externalId: "PROJ-2", method: "official_link", confidence: "certain" },
    });

    // Site-wide status list — shared, never scoped by issue.
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "status:10001:hash",
        sourceHash: "status:10001:hash",
        payload: { id: "10001", name: "To Do", statusCategory: { key: "new", name: "To Do" } },
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function issueRawEvent(key: string) {
    return {
      id: key,
      key,
      self: `https://acme.atlassian.net/rest/api/3/issue/${key}`,
      fields: {
        summary: `Summary for ${key}`,
        status: { id: "10001", name: "To Do" },
        priority: null,
        project: { id: "1", key: "PROJ", name: "Project" },
        created: "2026-03-01T09:00:00.000+0000",
        updated: "2026-03-01T09:00:00.000+0000",
        reporter: null,
        assignee: null,
      },
    };
  }

  async function seedIssue(key: string, providerEventId: string) {
    await prisma.rawEvent.create({
      data: { integrationId, providerEventId, sourceHash: providerEventId, payload: issueRawEvent(key) },
    });
  }

  it("a scoped run for one issue never writes NormalizedEvents onto a different issue's Case", async () => {
    await seedIssue("PROJ-1", "issue:PROJ-1:hash-1");
    await seedIssue("PROJ-2", "issue:PROJ-2:hash-1");

    await normalizeJira(prisma, integrationId, { issueKeys: ["PROJ-1"] });

    const eventsA = await prisma.normalizedEvent.count({ where: { caseId: caseAId } });
    const eventsB = await prisma.normalizedEvent.count({ where: { caseId: caseBId } });
    expect(eventsA).toBeGreaterThan(0);
    expect(eventsB).toBe(0);
  });

  it("a scoped run ignores a different issue's newer changelog entry sitting in the same integration", async () => {
    await seedIssue("PROJ-1", "issue:PROJ-1:hash-1");
    await seedIssue("PROJ-2", "issue:PROJ-2:hash-1");
    await normalizeJira(prisma, integrationId);

    const eventsBBefore = await prisma.normalizedEvent.count({ where: { caseId: caseBId } });

    // A new status-change history for PROJ-2 only — the webhook that fires
    // is for PROJ-1.
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "issue_changelog:PROJ-2:1001",
        sourceHash: "issue_changelog:PROJ-2:1001",
        payload: {
          id: "1001",
          author: { accountId: "user-1" },
          created: "2026-03-02T09:00:00.000+0000",
          items: [{ field: "status", fieldtype: "jira", from: "10001", fromString: "To Do", to: "10001", toString: "To Do" }],
        },
      },
    });

    await normalizeJira(prisma, integrationId, { issueKeys: ["PROJ-1"] });

    const eventsBAfter = await prisma.normalizedEvent.count({ where: { caseId: caseBId } });
    expect(eventsBAfter).toBe(eventsBBefore);
  });

  it("an unscoped run (the worker's full-account cycle) still processes every linked issue", async () => {
    await seedIssue("PROJ-1", "issue:PROJ-1:hash-1");
    await seedIssue("PROJ-2", "issue:PROJ-2:hash-1");

    await normalizeJira(prisma, integrationId);

    const eventsA = await prisma.normalizedEvent.count({ where: { caseId: caseAId } });
    const eventsB = await prisma.normalizedEvent.count({ where: { caseId: caseBId } });
    expect(eventsA).toBeGreaterThan(0);
    expect(eventsB).toBeGreaterThan(0);
  });

  it("an issue linked to several cases derives its events onto every one of them", async () => {
    // PROJ-1 is also what case B reports (e.g. two conversations sharing one tracker).
    await prisma.caseLink.create({
      data: { caseId: caseBId, system: "jira", externalId: "PROJ-1", method: "official_link", confidence: "certain" },
    });
    await seedIssue("PROJ-1", "issue:PROJ-1:hash-1");

    await normalizeJira(prisma, integrationId);

    for (const caseId of [caseAId, caseBId]) {
      const jiraEvents = await prisma.normalizedEvent.findMany({ where: { caseId, system: "jira" } });
      expect(jiraEvents.length).toBeGreaterThan(0);
    }
    const linkA = await prisma.caseLink.findFirstOrThrow({ where: { caseId: caseAId, externalId: "PROJ-1" } });
    const linkB = await prisma.caseLink.findFirstOrThrow({ where: { caseId: caseBId, externalId: "PROJ-1" } });
    expect((linkA.evidence as { statusName?: string }).statusName).toBe("To Do");
    expect((linkB.evidence as { statusName?: string }).statusName).toBe("To Do");
  });

  it("an ended (unlinked) link no longer routes the issue's events to its case", async () => {
    await prisma.caseLink.updateMany({ where: { caseId: caseAId }, data: { unlinkedAt: new Date("2026-03-02") } });
    await seedIssue("PROJ-1", "issue:PROJ-1:hash-1");

    await normalizeJira(prisma, integrationId);

    expect(await prisma.normalizedEvent.count({ where: { caseId: caseAId } })).toBe(0);
  });
});
