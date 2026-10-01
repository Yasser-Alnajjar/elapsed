/**
 * `POST /api/webhooks/zendesk/[integrationId]` end-to-end (roadmap task
 * 2.8): signature verification, the single-ticket scoping from 2.4, the
 * 404-on-refetch soft-delete, and the per-integration advisory lock — driven
 * through the real route handler against a real Postgres, with only the
 * outbound Zendesk API calls (`global.fetch`) mocked.
 *
 * Real Postgres, like organization-lock.test.ts. Needs a migrated database
 * at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceIntegration } from "./source-integration";
import { normalizeZendesk } from "./ingest-helpers";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;
const ORIGINAL_INTEGRATION_CONFIG_KEY = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
const ORIGINAL_INTEGRATION_TOKEN_KEY = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!TEST_DATABASE_URL)("POST /api/webhooks/zendesk/[integrationId] (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");
  let zendesk: typeof import("@sla/zendesk");

  let organizationId: string;
  let integrationId: string;
  const webhookSecret = "webhook-secret-abc123";

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
    zendesk = await import("@sla/zendesk");
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
    await db.saveIntegrationConfig(prisma, organizationId, "zendesk", { clientId: "client-1", clientSecret: "secret-1" });
    const integration = await prisma.integration.create({
      data: {
        organizationId,
        provider: "zendesk",
        status: "connected",
        webhookSecret,
        credentials: db.encryptCredentials({ subdomain: "acme", accessToken: "access-1", tokenType: "bearer", scope: "read" }),
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

  function webhookRequest(body: unknown, authorization = `Bearer ${webhookSecret}`) {
    return new Request(`http://localhost/api/webhooks/zendesk/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    });
  }

  function payload(ticketId: number, timestamp = new Date().toISOString()) {
    return { ticket_id: String(ticketId), timestamp };
  }

  function ticket(id: number, subject: string) {
    return {
      id,
      url: `https://acme.zendesk.com/api/v2/tickets/${id}.json`,
      external_id: null,
      subject,
      created_at: "2026-03-01T00:00:00Z",
      updated_at: "2026-03-01T00:00:00Z",
      status: "open",
      priority: null,
      organization_id: null,
    };
  }

  function stubFetchForTicket(id: number, subject: string) {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes(`/api/v2/tickets/${id}.json`)) {
        return jsonResponse(200, { ticket: ticket(id, subject) });
      }
      if (url.includes(`/api/v2/tickets/${id}/audits.json`)) {
        return jsonResponse(200, { audits: [], next_page: null });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("rejects a request with a missing/wrong bearer token, without touching the database", async () => {
    stubFetchForTicket(1, "irrelevant");
    const { POST } = await import("../src/app/api/webhooks/zendesk/[integrationId]/route");

    const response = await POST(webhookRequest(payload(1), "Bearer wrong-secret"), {
      params: Promise.resolve({ integrationId }),
    });

    expect(response.status).toBe(401);
    expect(await prisma.case.count()).toBe(0);
  });

  it("rejects a stale/missing timestamp", async () => {
    stubFetchForTicket(1, "irrelevant");
    const { POST } = await import("../src/app/api/webhooks/zendesk/[integrationId]/route");

    const staleTimestamp = new Date(Date.now() - 60 * 60_000).toISOString();
    const response = await POST(webhookRequest(payload(1, staleTimestamp)), {
      params: Promise.resolve({ integrationId }),
    });

    expect(response.status).toBe(401);
  });

  it("ignores a webhook for a disconnected integration", async () => {
    await prisma.integration.update({ where: { id: integrationId }, data: { status: "disconnected" } });
    const { POST } = await import("../src/app/api/webhooks/zendesk/[integrationId]/route");

    const response = await POST(webhookRequest(payload(1)), { params: Promise.resolve({ integrationId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ignored", reason: "integration disconnected" });
  });

  it("processes a ticket end-to-end: ingests, normalizes, and creates the Case", async () => {
    stubFetchForTicket(1, "Cannot log in");
    const { POST } = await import("../src/app/api/webhooks/zendesk/[integrationId]/route");

    const response = await POST(webhookRequest(payload(1)), { params: Promise.resolve({ integrationId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("processed");

    const caseRow = await prisma.case.findFirst({ where: { organizationId, externalId: "1" } });
    expect(caseRow).not.toBeNull();
    expect(caseRow!.subject).toBe("Cannot log in");

    const updated = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
    expect(updated.lastSyncAt).not.toBeNull();
    expect(updated.lastSyncError).toBeNull();
  });

  it("soft-deletes the Case when the ticket 404s on refetch", async () => {
    // Ticket 2 already exists as a Case (from an earlier normal sync).
    await prisma.case.create({
      data: { organizationId, externalId: "2", system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), subject: "Old ticket", openedAt: new Date("2026-03-01") },
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/api/v2/tickets/2.json")) return jsonResponse(404, { error: "RecordNotFound" });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../src/app/api/webhooks/zendesk/[integrationId]/route");
    const response = await POST(webhookRequest(payload(2)), { params: Promise.resolve({ integrationId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "deleted", ticketId: 2 });

    const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "2" } });
    expect(caseRow.deletedAt).not.toBeNull();
  });

  it("a webhook for one ticket never rewrites a different ticket's already-normalized Case (2.4 scoping, wired through the route)", async () => {
    // Ticket 3 was normalized by an earlier (unscoped) full-account run.
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "ticket:3:seed",
        sourceHash: "seed",
        payload: ticket(3, "Ticket three original subject"),
      },
    });
    await normalizeZendesk(prisma, integrationId);
    const caseThreeBefore = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "3" } });
    expect(caseThreeBefore.subject).toBe("Ticket three original subject");

    // The webhook fires for a different ticket (1).
    stubFetchForTicket(1, "Ticket one");
    const { POST } = await import("../src/app/api/webhooks/zendesk/[integrationId]/route");
    await POST(webhookRequest(payload(1)), { params: Promise.resolve({ integrationId }) });

    const caseThreeAfter = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "3" } });
    expect(caseThreeAfter.subject).toBe("Ticket three original subject"); // untouched
    const caseOne = await prisma.case.findFirst({ where: { organizationId, externalId: "1" } });
    expect(caseOne).not.toBeNull();
  });
});
