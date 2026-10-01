/**
 * `POST /api/webhooks/jira/[integrationId]` end-to-end (roadmap task 2.8):
 * signature verification, the single-issue scoping from 2.4, the
 * `jira:issue_deleted` and 404-on-refetch unlink handling from 2.6, and the
 * per-integration advisory lock — driven through the real route handler
 * against a real Postgres, with only the outbound Jira API calls
 * (`global.fetch`) mocked.
 *
 * Real Postgres, like organization-lock.test.ts. Needs a migrated database
 * at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import { createHmac } from "node:crypto";
import type { PrismaClient } from "@sla/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;
const ORIGINAL_INTEGRATION_CONFIG_KEY = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
const ORIGINAL_INTEGRATION_TOKEN_KEY = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!TEST_DATABASE_URL)("POST /api/webhooks/jira/[integrationId] (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");

  let organizationId: string;
  let integrationId: string;
  const webhookSecret = "webhook-secret-abc123";
  const cloudId = "cloud-1";

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    process.env.NEXTAUTH_URL = "https://app.example.com";
    process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "test-integration-config-key";
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "test-integration-token-key";

    const organization = await prisma.organization.create({ data: { name: "Acme" } });
    organizationId = organization.id;
    await db.saveIntegrationConfig(prisma, organizationId, "jira", { clientId: "client-1", clientSecret: "secret-1" });
    const integration = await prisma.integration.create({
      data: {
        organizationId,
        provider: "jira",
        status: "connected",
        webhookSecret,
        credentials: db.encryptCredentials({
          cloudId,
          siteUrl: "https://acme.atlassian.net",
          accessToken: "access-1",
          tokenType: "bearer",
          scope: "read:jira-work",
        }),
      },
    });
    integrationId = integration.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
    process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = ORIGINAL_INTEGRATION_CONFIG_KEY;
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = ORIGINAL_INTEGRATION_TOKEN_KEY;
    await prisma?.$disconnect();
  });

  function signedRequest(payload: object) {
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", webhookSecret).update(body, "utf8").digest("hex");
    return new Request(`http://localhost/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature": `sha256=${signature}` },
      body,
    });
  }

  function eventPayload(webhookEvent: string, issueKey: string, timestamp = Date.now()) {
    return { webhookEvent, timestamp, issue: { key: issueKey } };
  }

  function issue(key: string) {
    return {
      id: key,
      key,
      self: `https://acme.atlassian.net/rest/api/3/issue/${key}`,
      fields: {
        summary: `Summary for ${key}`,
        status: { id: "1", name: "To Do" },
        priority: null,
        project: { id: "1", key: "ENG", name: "Engineering" },
        created: "2026-03-01T09:00:00.000+0000",
        updated: "2026-03-01T09:00:00.000+0000",
        reporter: null,
        assignee: null,
      },
    };
  }

  function stubFetchForIssue(key: string) {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/rest/api/3/status")) {
        return jsonResponse(200, [{ id: "1", name: "To Do", statusCategory: { key: "new" } }]);
      }
      // Checked before the plain issue-fetch match below: both the changelog
      // and remotelink URLs also contain `/rest/api/3/issue/${key}` as a
      // substring, so matching that first would swallow these two requests.
      if (url.includes("/changelog")) {
        return jsonResponse(200, { values: [], startAt: 0, maxResults: 100, total: 0, isLast: true });
      }
      if (url.includes("/remotelink")) {
        return jsonResponse(200, []);
      }
      if (url.includes(`/rest/api/3/issue/${key}`)) {
        return jsonResponse(200, issue(key));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("rejects a request with an invalid signature, without touching the database", async () => {
    stubFetchForIssue("ENG-1");
    const { POST } = await import("../src/app/api/webhooks/jira/[integrationId]/route");

    const badRequest = new Request(`http://localhost/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature": "sha256=" + "0".repeat(64) },
      body: JSON.stringify(eventPayload("jira:issue_updated", "ENG-1")),
    });
    const response = await POST(badRequest, { params: Promise.resolve({ integrationId }) });

    expect(response.status).toBe(401);
    expect(await prisma.rawEvent.count()).toBe(0);
  });

  it("rejects a stale/missing timestamp", async () => {
    stubFetchForIssue("ENG-1");
    const { POST } = await import("../src/app/api/webhooks/jira/[integrationId]/route");

    const staleTimestamp = Date.now() - 60 * 60_000;
    const response = await POST(signedRequest(eventPayload("jira:issue_updated", "ENG-1", staleTimestamp)), {
      params: Promise.resolve({ integrationId }),
    });

    expect(response.status).toBe(401);
  });

  it("ignores a webhook for a disconnected integration", async () => {
    await prisma.integration.update({ where: { id: integrationId }, data: { status: "disconnected" } });
    const { POST } = await import("../src/app/api/webhooks/jira/[integrationId]/route");

    const response = await POST(signedRequest(eventPayload("jira:issue_updated", "ENG-1")), {
      params: Promise.resolve({ integrationId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ignored", reason: "integration disconnected" });
  });

  it("processes jira:issue_updated end-to-end: ingests the issue and its status/changelog/remote-link manifest", async () => {
    stubFetchForIssue("ENG-1");
    const { POST } = await import("../src/app/api/webhooks/jira/[integrationId]/route");

    const response = await POST(signedRequest(eventPayload("jira:issue_updated", "ENG-1")), {
      params: Promise.resolve({ integrationId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("processed");
    expect(await prisma.rawEvent.findFirst({ where: { integrationId, providerEventId: { startsWith: "issue:ENG-1:" } } })).not.toBeNull();
    expect(
      await prisma.rawEvent.findFirst({ where: { integrationId, providerEventId: { startsWith: "remote_link_manifest:ENG-1:" } } }),
    ).not.toBeNull();

    const updated = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
    expect(updated.lastSyncAt).not.toBeNull();
    expect(updated.lastSyncError).toBeNull();
  });

  it("jira:issue_deleted unlinks every active CaseLink for that issue, without attempting a refetch", async () => {
    const caseRow = await prisma.case.create({
      data: { organizationId, externalId: "9", system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), subject: "Ticket 9", openedAt: new Date("2026-03-01") },
    });
    await prisma.caseLink.create({
      data: { caseId: caseRow.id, system: "jira", externalId: "ENG-2", method: "remote_link", confidence: "certain" },
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      throw new Error(`Unexpected fetch — issue_deleted must never refetch: ${input.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../src/app/api/webhooks/jira/[integrationId]/route");
    const response = await POST(signedRequest(eventPayload("jira:issue_deleted", "ENG-2")), {
      params: Promise.resolve({ integrationId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "processed", issueKey: "ENG-2", reason: "issue deleted" });
    expect(fetchMock).not.toHaveBeenCalled();

    const link = await prisma.caseLink.findUnique({
      where: { caseId_system_externalId: { caseId: caseRow.id, system: "jira", externalId: "ENG-2" } },
    });
    expect(link!.unlinkedAt).not.toBeNull();
    expect(await prisma.normalizedEvent.count({ where: { caseId: caseRow.id, type: "issue_unlinked" } })).toBe(1);
  });

  it("a 404 on the targeted refetch unlinks every active CaseLink for that issue (2.6b — the same fact as jira:issue_deleted)", async () => {
    const caseRow = await prisma.case.create({
      data: { organizationId, externalId: "10", system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), subject: "Ticket 10", openedAt: new Date("2026-03-01") },
    });
    await prisma.caseLink.create({
      data: { caseId: caseRow.id, system: "jira", externalId: "ENG-3", method: "remote_link", confidence: "certain" },
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/rest/api/3/status")) {
        return jsonResponse(200, [{ id: "1", name: "To Do", statusCategory: { key: "new" } }]);
      }
      if (url.includes("/rest/api/3/issue/ENG-3")) {
        return jsonResponse(404, { errorMessages: ["Issue does not exist"] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../src/app/api/webhooks/jira/[integrationId]/route");
    const response = await POST(signedRequest(eventPayload("jira:issue_updated", "ENG-3")), {
      params: Promise.resolve({ integrationId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ignored", reason: "issue not found" });

    const link = await prisma.caseLink.findUnique({
      where: { caseId_system_externalId: { caseId: caseRow.id, system: "jira", externalId: "ENG-3" } },
    });
    expect(link!.unlinkedAt).not.toBeNull();
  });

  it("a webhook for one issue never rewrites a different issue's already-normalized Case (2.4 scoping, wired through the route)", async () => {
    const caseA = await prisma.case.create({
      data: { organizationId, externalId: "11", system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), subject: "Case A", openedAt: new Date("2026-03-01") },
    });
    const caseB = await prisma.case.create({
      data: { organizationId, externalId: "12", system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), subject: "Case B", openedAt: new Date("2026-03-01") },
    });
    await prisma.caseLink.create({
      data: { caseId: caseA.id, system: "jira", externalId: "ENG-4", method: "official_link", confidence: "certain" },
    });
    await prisma.caseLink.create({
      data: { caseId: caseB.id, system: "jira", externalId: "ENG-5", method: "official_link", confidence: "certain" },
    });

    const eventsBBefore = await prisma.normalizedEvent.count({ where: { caseId: caseB.id } });

    stubFetchForIssue("ENG-4");
    const { POST } = await import("../src/app/api/webhooks/jira/[integrationId]/route");
    await POST(signedRequest(eventPayload("jira:issue_updated", "ENG-4")), { params: Promise.resolve({ integrationId }) });

    const eventsAAfter = await prisma.normalizedEvent.count({ where: { caseId: caseA.id } });
    const eventsBAfter = await prisma.normalizedEvent.count({ where: { caseId: caseB.id } });
    expect(eventsAAfter).toBeGreaterThan(0);
    expect(eventsBAfter).toBe(eventsBBefore); // untouched
  });
});
