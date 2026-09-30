/**
 * N1.13: Jira and Linear resolve external links to cases through a resolver
 * built from the organization's connected ticket sources, so an Intercom
 * conversation link correlates exactly like a Zendesk ticket link. Real
 * Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { correlateJira } from "./correlate-helper";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("tracker link resolution (real Postgres)", () => {
  let prisma: PrismaClient;
  let jira: typeof import("@sla/jira");
  let linear: typeof import("@sla/linear");
  let commitments: typeof import("@sla/commitments");
  let zendesk: typeof import("@sla/zendesk");
  let intercom: typeof import("@sla/intercom");

  let organizationId: string;
  let jiraIntegrationId: string;
  let linearIntegrationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    jira = await import("@sla/jira");
    linear = await import("@sla/linear");
    commitments = await import("@sla/commitments");
    zendesk = await import("@sla/zendesk");
    intercom = await import("@sla/intercom");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    organizationId = (await prisma.organization.create({ data: { name: "Tracker Links Org" } })).id;
    jiraIntegrationId = (
      await prisma.integration.create({ data: { organizationId, provider: "jira", credentials: { cloudId: "c", siteUrl: "https://x.atlassian.net" } } })
    ).id;
    linearIntegrationId = (await prisma.integration.create({ data: { organizationId, provider: "linear", credentials: {} } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const resolver = () =>
    commitments.buildCaseRefResolver(prisma, organizationId, {
      zendesk: zendesk.recognizeZendeskTicketUrl,
      intercom: intercom.recognizeIntercomConversationUrl,
    });

  const connectIntercom = () =>
    prisma.integration.create({ data: { organizationId, provider: "intercom", credentials: { workspaceId: "ws1" } } });
  const connectZendesk = () =>
    prisma.integration.create({ data: { organizationId, provider: "zendesk", credentials: { subdomain: "acme" } } });
  const seedCase = (externalId: string, system: "zendesk" | "intercom", deletedAt: Date | null = null) =>
    prisma.case.create({ data: { organizationId, externalId, system, openedAt: new Date("2026-09-01T00:00:00Z"), deletedAt } });

  describe("buildCaseRefResolver", () => {
    it("is null when the organization has no connected ticket source", async () => {
      expect(await resolver()).toBeNull();
    });

    it("resolves a Zendesk ticket URL and an Intercom conversation URL to their cases", async () => {
      await connectZendesk();
      await connectIntercom();
      const z = await seedCase("42", "zendesk");
      const i = await seedCase("9001", "intercom");
      const resolve = (await resolver())!;

      expect(await resolve("https://acme.zendesk.com/agent/tickets/42")).toEqual({ kind: "case", caseId: z.id });
      expect(await resolve("https://app.intercom.com/a/apps/ws1/conversations/9001")).toEqual({ kind: "case", caseId: i.id });
    });

    it("separates an unrecognized URL from a recognized one with no live case", async () => {
      await connectIntercom();
      await seedCase("5", "intercom", new Date());
      const resolve = (await resolver())!;

      expect(await resolve("https://example.com/whatever")).toEqual({ kind: "unrecognized" });
      expect(await resolve("https://app.intercom.com/a/apps/other-ws/conversations/5")).toEqual({ kind: "unrecognized" });
      expect(await resolve("https://app.intercom.com/a/apps/ws1/conversations/404")).toEqual({ kind: "no_case" });
      expect(await resolve("https://app.intercom.com/a/apps/ws1/conversations/5")).toEqual({ kind: "no_case" }); // soft-deleted
    });

    it("never lets one source's id land on another source's case that shares the externalId", async () => {
      await connectZendesk();
      await seedCase("77", "intercom");
      const resolve = (await resolver())!;

      expect(await resolve("https://acme.zendesk.com/agent/tickets/77")).toEqual({ kind: "no_case" });
    });
  });

  describe("Jira", () => {
    async function seedRemoteLink(issueKey: string, url: string) {
      const input = jira.mapRemoteLinkToRawEvent(issueKey, { id: 1, self: "s", object: { url, title: "t" } });
      await prisma.rawEvent.create({
        data: {
          integrationId: jiraIntegrationId,
          providerEventId: input.providerEventId,
          sourceHash: input.sourceHash,
          payload: input.payload as never,
        },
      });
    }

    it("links an issue to an Intercom conversation through its remote link", async () => {
      await connectIntercom();
      const c = await seedCase("9001", "intercom");
      await seedRemoteLink("KAN-1", "https://app.intercom.com/a/apps/ws1/conversations/9001");

      const result = await correlateJira(prisma, jiraIntegrationId);

      expect(result).toMatchObject({ caseLinksCreated: 1, unmatchedUnrecognizedUrl: 0, unmatchedNoCase: 0 });
      expect(await prisma.caseLink.findFirstOrThrow({ where: { caseId: c.id, system: "jira" } })).toMatchObject({
        externalId: "KAN-1",
        method: "remote_link",
        confidence: "certain",
      });
    });

    it("does nothing without a connected ticket source", async () => {
      await seedRemoteLink("KAN-1", "https://app.intercom.com/a/apps/ws1/conversations/9001");
      expect(await correlateJira(prisma, jiraIntegrationId)).toMatchObject({ remoteLinksEvaluated: 0, caseLinksCreated: 0 });
    });
  });

  describe("Linear", () => {
    async function seedAttachment(url: string) {
      const issue = { id: "iss1", identifier: "ENG-1", url: "https://linear.app/x/issue/ENG-1" };
      await prisma.rawEvent.createMany({
        data: [
          { integrationId: linearIntegrationId, providerEventId: "issue:iss1:h", sourceHash: "h", payload: issue },
          { integrationId: linearIntegrationId, providerEventId: "attachment:iss1:att1:h", sourceHash: "h", payload: { id: "att1", url, title: "t" } },
        ],
      });
    }

    it("links an issue to an Intercom conversation through its attachment", async () => {
      await connectIntercom();
      const c = await seedCase("9001", "intercom");
      await seedAttachment("https://app.intercom.com/a/apps/ws1/conversations/9001");

      const result = await linear.runLinearCorrelation(prisma, linearIntegrationId, await resolver());

      expect(result).toMatchObject({ caseLinksCreated: 1, unmatchedUnrecognizedUrl: 0 });
      expect(await prisma.caseLink.count({ where: { caseId: c.id, system: "linear", externalId: "ENG-1" } })).toBe(1);
    });

    it("counts a URL no ticket source recognizes", async () => {
      await connectZendesk();
      await seedAttachment("https://old.zendesk.com/agent/tickets/1");

      const result = await linear.runLinearCorrelation(prisma, linearIntegrationId, await resolver());

      expect(result).toMatchObject({ caseLinksCreated: 0, unmatchedUnrecognizedUrl: 1 });
    });
  });
});
