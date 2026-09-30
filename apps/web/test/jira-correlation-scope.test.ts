/**
 * Roadmap task 2.4: `runJiraCorrelation`'s new `{ issueKey }` scope
 * (packages/jira/src/correlate.ts) — used by the Jira webhook route so a
 * single issue update doesn't re-evaluate every remote link the integration
 * has ever seen. Proves a scoped run for one issue's remote link never
 * touches (creates or reactivates) a CaseLink for a different issue, even
 * when that other issue also has a newer, unprocessed remote-link snapshot
 * sitting in the same integration.
 *
 * Real Postgres, like official-link-correlation.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { correlateJira } from "./correlate-helper";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("runJiraCorrelation issue scoping (real Postgres)", () => {
  let prisma: PrismaClient;
  let jira: typeof import("@sla/jira");

  let organizationId: string;
  let jiraIntegrationId: string;

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
    const zendeskIntegration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "acme" } },
    });
    const jiraIntegration = await prisma.integration.create({
      data: {
        organizationId,
        provider: "jira",
        credentials: { cloudId: "cloud", siteUrl: "https://acme.atlassian.net", accessToken: "token", tokenType: "bearer" },
      },
    });
    jiraIntegrationId = jiraIntegration.id;

    await prisma.case.create({
      data: { organizationId, externalId: "1", system: "zendesk", sourceIntegrationId: zendeskIntegration.id, subject: "Ticket 1", openedAt: new Date("2026-03-01") },
    });
    await prisma.case.create({
      data: { organizationId, externalId: "2", system: "zendesk", sourceIntegrationId: zendeskIntegration.id, subject: "Ticket 2", openedAt: new Date("2026-03-01") },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function remoteLink(issueKey: string, ticketId: string) {
    return {
      id: `link-${issueKey}`,
      object: { url: `https://acme.zendesk.com/agent/tickets/${ticketId}`, title: `Ticket ${ticketId}` },
    };
  }

  async function seedRemoteLink(issueKey: string, ticketId: string, providerEventId: string) {
    await prisma.rawEvent.create({
      data: { integrationId: jiraIntegrationId, providerEventId, sourceHash: providerEventId, payload: remoteLink(issueKey, ticketId) },
    });
  }

  it("a scoped run for one issue never creates a CaseLink from a different issue's remote link", async () => {
    await seedRemoteLink("PROJ-1", "1", "remote_link:PROJ-1:link-1:hash-1");
    await seedRemoteLink("PROJ-2", "2", "remote_link:PROJ-2:link-2:hash-1");

    await correlateJira(prisma, jiraIntegrationId, { issueKey: "PROJ-1" });

    const linkA = await prisma.caseLink.findFirst({ where: { externalId: "PROJ-1" } });
    const linkB = await prisma.caseLink.findFirst({ where: { externalId: "PROJ-2" } });
    expect(linkA).not.toBeNull();
    expect(linkB).toBeNull();
  });

  it("an unscoped run still evaluates every issue's remote links", async () => {
    await seedRemoteLink("PROJ-1", "1", "remote_link:PROJ-1:link-1:hash-1");
    await seedRemoteLink("PROJ-2", "2", "remote_link:PROJ-2:link-2:hash-1");

    await correlateJira(prisma, jiraIntegrationId);

    const linkA = await prisma.caseLink.findFirst({ where: { externalId: "PROJ-1" } });
    const linkB = await prisma.caseLink.findFirst({ where: { externalId: "PROJ-2" } });
    expect(linkA).not.toBeNull();
    expect(linkB).not.toBeNull();
  });
});
