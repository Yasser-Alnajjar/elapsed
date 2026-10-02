/**
 * Roadmap 7.9 — smoke end-to-end test with a stubbed provider: signup ->
 * connect -> import -> case -> SLA -> customer reply -> agent reply ->
 * breach -> alert.
 *
 * This is not another pass at SLA math (`sla-golden-scenarios.test.ts`) or
 * policy re-resolution (`sla-e2e-matrix.test.ts`) — it's a single
 * continuous run through the real chain a brand-new customer actually goes
 * through, asserting that each stage actually happened and handed off to
 * the next one:
 *
 *   1. signup     - the real `POST /api/sign-up` route creates the
 *                    Organization + owner User.
 *   2. connect     - an Integration + IntegrationConfig + SLAPolicy +
 *                    BusinessCalendar are seeded directly (no OAuth UI to
 *                    drive in a vitest environment — see the note below).
 *   3. import/case - the real `POST /api/webhooks/zendesk/[integrationId]`
 *                    route handler is driven three times, each with a
 *                    stubbed `fetch` standing in for the Zendesk API
 *                    (same stubbing shape as zendesk-webhook-route.test.ts
 *                    and packages/zendesk/test/backfill.test.ts): once for
 *                    the initial ticket (import/case/SLA), once for the
 *                    agent's first reply, and once for a customer reply
 *                    followed by the agent's reply to it (Next Reply cycle).
 *                    The webhook route runs its full pipeline tail
 *                    (ingest -> normalize -> commitments -> re-resolution
 *                    -> Next Reply cycles -> evaluation -> notifications)
 *                    on every call, exactly as production traffic does.
 *   4. breach      - `runEvaluationPipeline` (@sla/commitments) is called
 *                    directly with an explicit `asOf` well past the
 *                    Resolution target. This is the one place this test
 *                    doesn't go through the webhook route: the route always
 *                    evaluates at the real wall-clock "now", which this
 *                    suite has no control over, so the breach has to be
 *                    driven with an explicit future `asOf` the same way
 *                    sla-golden-scenarios.test.ts and sla-e2e-matrix.test.ts
 *                    already do.
 *   5. alert       - `runNotificationPipeline` (@sla/notifications) is run
 *                    with `@sla/slack`'s `postMessage` mocked (same mock
 *                    sla-golden-scenarios.test.ts and sla-e2e-matrix.test.ts
 *                    use), and both the mocked channel call and the
 *                    resulting `Notification` row are asserted.
 *
 * Real Postgres, like the other suites here. Needs a migrated database at
 * TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { Prisma, PrismaClient } from "@sla/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;
const ORIGINAL_INTEGRATION_CONFIG_KEY = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
const ORIGINAL_INTEGRATION_TOKEN_KEY = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;

const SUBDOMAIN = "smoke";
const SIGNUP_EMAIL = "owner@smoke-e2e.example.com";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!TEST_DATABASE_URL)("smoke: signup -> connect -> import -> case -> SLA -> reply -> breach -> alert (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");
  let commitments: typeof import("@sla/commitments");
  let notifications: typeof import("@sla/notifications");
  let postMessage: ReturnType<typeof vi.fn>;

  const webhookSecret = "smoke-webhook-secret-abc123";

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
    commitments = await import("@sla/commitments");
    notifications = await import("@sla/notifications");
    postMessage = (await import("@sla/slack")).postMessage as ReturnType<typeof vi.fn>;
  });

  beforeEach(async () => {
    postMessage.mockClear();
    postMessage.mockResolvedValue(undefined);

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    process.env.NEXTAUTH_URL = "https://app.example.com";
    process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "test-integration-config-key";
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "test-integration-token-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  afterAll(async () => {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
    process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = ORIGINAL_INTEGRATION_CONFIG_KEY;
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = ORIGINAL_INTEGRATION_TOKEN_KEY;
    await prisma?.$disconnect();
  });

  // ---- ticket/audit fixture builders (mirrors sla-golden-scenarios.test.ts / zendesk-webhook-route.test.ts) ----

  function ticket(id: number, overrides: Record<string, unknown> = {}, createdAt: string) {
    return {
      id,
      url: `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/${id}.json`,
      external_id: null,
      subject: "Checkout button does nothing",
      created_at: createdAt,
      updated_at: createdAt,
      status: "open",
      priority: "normal",
      organization_id: null,
      requester_id: 900,
      via: { channel: "web" },
      ...overrides,
    };
  }

  let nextAuditId = 1;
  function replyAudit(ticketId: number, time: string, authorRole: "agent" | "customer") {
    const id = nextAuditId++;
    const authorId = authorRole === "agent" ? 500 : 900;
    return {
      id,
      ticket_id: ticketId,
      created_at: time,
      author_id: authorId,
      via: { channel: "web" },
      events: [{ id: id * 10, type: "Comment", public: true, author_id: authorId, plain_body: "reply" }],
    };
  }

  function webhookRequest(integrationId: string, ticketId: number, timestamp: string) {
    return new Request(`http://localhost/api/webhooks/zendesk/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${webhookSecret}` },
      body: JSON.stringify({ ticket_id: String(ticketId), timestamp }),
    });
  }

  /** Stubs `fetch` so a webhook delivery for `ticketId` sees this ticket snapshot and these audits. */
  function stubFetchForTicket(ticketPayload: unknown, audits: unknown[]) {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes(`/tickets/${(ticketPayload as { id: number }).id}.json`)) {
        return jsonResponse(200, { ticket: ticketPayload });
      }
      if (url.includes(`/tickets/${(ticketPayload as { id: number }).id}/audits.json`)) {
        return jsonResponse(200, { audits, next_page: null });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("drives a brand-new customer from sign-up through a breached SLA and a sent alert", async () => {
    // ---- 1. signup: the real sign-up route creates the Organization + owner User ----
    const { POST: signUp } = await import("../src/app/api/sign-up/route");
    const signUpResponse = await signUp(
      new Request("http://localhost/api/sign-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationName: "Smoke E2E Inc",
          email: SIGNUP_EMAIL,
          password: "correct horse battery staple",
          fullName: "Sam Owner",
          acceptedTerms: true,
        }),
      }),
    );
    expect(signUpResponse.status).toBe(200);
    expect(await signUpResponse.json()).toEqual({ ok: true });

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: SIGNUP_EMAIL } });
    expect(owner.role).toBe("owner");
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: owner.organizationId } });
    expect(organization.name).toBe("Smoke E2E Inc");
    const organizationId = organization.id;

    // ---- 2. connect: Zendesk integration + SLA policy + calendar (no OAuth UI to drive here) ----
    await db.saveIntegrationConfig(prisma, organizationId, "zendesk", { clientId: "smoke-client", clientSecret: "smoke-secret" });
    const integration = await prisma.integration.create({
      data: {
        organizationId,
        provider: "zendesk",
        status: "connected",
        lastSuccessfulSyncAt: new Date(),
        webhookSecret,
        credentials: db.encryptCredentials({ subdomain: SUBDOMAIN, accessToken: "access-token", tokenType: "bearer", scope: "read" }),
      },
    });
    const integrationId = integration.id;
    expect(integration.status).toBe("connected");

    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const calendarVersionId = calendar.versions[0]!.id;

    const FIRST_RESPONSE_TARGET_MINUTES = 60;
    const NEXT_REPLY_TARGET_MINUTES = 30;
    const RESOLUTION_TARGET_MINUTES = 120;
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "Default" } });
    await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {} as Prisma.InputJsonValue,
        targets: [
          { kind: "first_response", minutes: FIRST_RESPONSE_TARGET_MINUTES },
          { kind: "next_reply", minutes: NEXT_REPLY_TARGET_MINUTES },
          { kind: "resolution", minutes: RESOLUTION_TARGET_MINUTES },
        ] as unknown as Prisma.InputJsonValue,
        pauseOnStates: [],
        calendarVersionId,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: new Date(Date.now() - 24 * 60 * 60_000),
      },
    });

    const TICKET_ID = 1;
    // The webhook route always evaluates commitments at the real wall-clock
    // "now" (`asOf = new Date().toISOString()` in webhook-pipeline.ts), and
    // `evaluateCommitment` only counts a completion event once
    // `event.occurredAt <= asOf`. Three webhook deliveries happen only
    // milliseconds apart in real time, so simulating "5 minutes later, the
    // agent replied" needs the system clock itself faked and advanced
    // between calls — real elapsed time can't do it, and pre-dating the
    // fixtures instead would make the very first commitment already
    // `at_risk`/`breached` by the time it's created.
    const base = Date.now();
    const at = (minutesFromBase: number) => new Date(base + minutesFromBase * 60_000).toISOString();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at(0)));

    // ---- 3a. import/case: the initial ticket, delivered through the real webhook route ----
    stubFetchForTicket(ticket(TICKET_ID, {}, at(0)), []);
    const { POST: webhook } = await import("../src/app/api/webhooks/zendesk/[integrationId]/route");
    const importResponse = await webhook(webhookRequest(integrationId, TICKET_ID, at(0)), {
      params: Promise.resolve({ integrationId }),
    });
    const importBody = await importResponse.json();
    expect(importResponse.status).toBe(200);
    expect(importBody.status).toBe("processed");

    expect(await prisma.rawEvent.count({ where: { integrationId } })).toBeGreaterThan(0);
    const zCase = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: String(TICKET_ID) } });
    expect(zCase.subject).toBe("Checkout button does nothing");

    let firstResponse = await prisma.commitment.findFirstOrThrow({ where: { caseId: zCase.id, kind: "first_response" } });
    expect(firstResponse).toMatchObject({ targetMinutes: FIRST_RESPONSE_TARGET_MINUTES, status: "on_track" });
    let resolution = await prisma.commitment.findFirstOrThrow({ where: { caseId: zCase.id, kind: "resolution" } });
    expect(resolution).toMatchObject({ targetMinutes: RESOLUTION_TARGET_MINUTES, status: "on_track" });

    // ---- 3b. agent reply: completes First Response ----
    vi.setSystemTime(new Date(at(5)));
    stubFetchForTicket(ticket(TICKET_ID, { updated_at: at(5) }, at(0)), [replyAudit(TICKET_ID, at(5), "agent")]);
    const agentReplyResponse = await webhook(webhookRequest(integrationId, TICKET_ID, at(5)), {
      params: Promise.resolve({ integrationId }),
    });
    expect((await agentReplyResponse.json()).status).toBe("processed");

    firstResponse = await prisma.commitment.findFirstOrThrow({ where: { caseId: zCase.id, kind: "first_response" } });
    expect(firstResponse).toMatchObject({ status: "met" });
    expect(firstResponse.closedAt).not.toBeNull();

    // ---- 3c. customer reply then agent reply: a Next Reply cycle opens and closes ----
    vi.setSystemTime(new Date(at(35)));
    stubFetchForTicket(ticket(TICKET_ID, { updated_at: at(35) }, at(0)), [
      replyAudit(TICKET_ID, at(5), "agent"),
      replyAudit(TICKET_ID, at(20), "customer"),
      replyAudit(TICKET_ID, at(35), "agent"),
    ]);
    const secondReplyResponse = await webhook(webhookRequest(integrationId, TICKET_ID, at(35)), {
      params: Promise.resolve({ integrationId }),
    });
    expect((await secondReplyResponse.json()).status).toBe("processed");

    const nextReplyCycles = await prisma.commitment.findMany({ where: { caseId: zCase.id, kind: "next_reply" } });
    expect(nextReplyCycles).toHaveLength(1);
    expect(nextReplyCycles[0]).toMatchObject({ status: "met", startedAt: new Date(at(20)) });
    expect(nextReplyCycles[0]!.closedAt).not.toBeNull();

    // Resolution is still open throughout — the case was never solved/closed.
    resolution = await prisma.commitment.findFirstOrThrow({ where: { caseId: zCase.id, kind: "resolution" } });
    expect(resolution.status).not.toBe("breached");
    expect(resolution.closedAt).toBeNull();

    // ---- 4. breach: advance past the Resolution target with an explicit asOf ----
    // The webhook route always evaluates at the real wall-clock "now", so
    // driving a deterministic breach means calling the evaluation pipeline
    // directly here, exactly as sla-golden-scenarios.test.ts and
    // sla-e2e-matrix.test.ts do for their own breach assertions. The faked
    // clock is no longer needed past this point.
    vi.useRealTimers();
    const breachAsOf = at(RESOLUTION_TARGET_MINUTES + 30);
    // The source is healthy at the simulated "now" (D13(b) holds breach alerts for stale sources).
    await prisma.integration.updateMany({ where: { organizationId }, data: { lastSuccessfulSyncAt: new Date(breachAsOf) } });
    const evaluated = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: breachAsOf, scope: "all" });
    // Not `commitmentsFinalized`: a breach only "finalizes" a commitment
    // once its clock actually stops (the case closes), per
    // active-commitment.ts — this resolution stays open (`closedAt: null`)
    // even once breached, so the pipeline just persists a new breach
    // evaluation for it instead.
    expect(evaluated.evaluationsCreated).toBeGreaterThanOrEqual(1);

    resolution = await prisma.commitment.findFirstOrThrow({ where: { caseId: zCase.id, kind: "resolution" } });
    expect(resolution.status).toBe("breached");
    const breachEvaluation = await prisma.evaluation.findFirstOrThrow({
      where: { commitmentId: resolution.id },
      orderBy: { evaluatedAt: "desc" },
    });
    expect(breachEvaluation.status).toBe("breached");

    expect(evaluated.notificationCandidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ commitmentId: resolution.id, threshold: 100, status: "breached" })]),
    );

    // ---- 5. alert: the breach reaches the notification stage and an alert is actually sent ----
    await prisma.slackIntegration.create({
      data: {
        organizationId,
        accessToken: "xoxb-smoke-test",
        teamId: "T-SMOKE",
        teamName: "Smoke E2E Inc",
        botUserId: "U-SMOKE",
        channelId: "C-SMOKE",
      },
    });

    const sent = await notifications.runNotificationPipeline(prisma, organizationId, evaluated.notificationCandidates, {
      appUrl: "http://localhost:3000",
    });
    expect(sent.notificationsSent).toBeGreaterThanOrEqual(1);
    expect(postMessage).toHaveBeenCalledWith("xoxb-smoke-test", "C-SMOKE", expect.any(String));

    const notificationRow = await prisma.notification.findFirstOrThrow({ where: { commitmentId: resolution.id } });
    expect(notificationRow).toMatchObject({ threshold: 100, channel: "slack" });
  });
});
