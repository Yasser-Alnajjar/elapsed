/**
 * N1.17 — 2×2 provider matrix smoke tests.
 *
 * One continuous run per (ticket source × tracker) pair:
 *
 *   ticket source:  Zendesk, Intercom
 *   tracker:        Jira,    Linear
 *
 * Each scenario seeds the RawEvents a backfill would have stored (through the
 * adapters' own `map*ToRawEvent` mappers, so nothing depends on live HTTP),
 * then runs the same DB-side chain a connect-time sync and the worker run:
 * `projectAndEvaluateSourceSyncs` (ticket-source normalization -> tracker
 * correlation and normalization -> commitments -> evaluation), then a breach
 * evaluation at an explicit future `asOf`, then notification claiming with
 * Slack mocked. It asserts, per pair:
 *
 *   - the case is created with the right `sourceIntegrationId` (N1.15);
 *   - its customer is resolved through `CustomerIdentity` (N1.14);
 *   - a `certain` CaseLink to the tracker issue exists;
 *   - the derived timeline has an `engineering` leg;
 *   - First Response and Resolution commitments are evaluated;
 *   - the breach raises one alert, and re-claiming the same candidates
 *     raises none (deduplicated).
 *
 * Only Zendesk and Jira have webhook routes; the Intercom and Linear legs
 * enter through their pipeline functions, as 7.9 does for evaluation.
 * Passing this promotes no pair to production (D17).
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type TicketSource = "zendesk" | "intercom";
type Tracker = "jira" | "linear";

const PAIRS: { source: TicketSource; tracker: Tracker; role: string }[] = [
  { source: "zendesk", tracker: "jira", role: "existing production baseline (regression)" },
  { source: "zendesk", tracker: "linear", role: "matrix validation" },
  { source: "intercom", tracker: "jira", role: "provider-boundary proof" },
  { source: "intercom", tracker: "linear", role: "provider-boundary proof" },
];

const FIRST_RESPONSE_MINUTES = 30;
const RESOLUTION_MINUTES = 120;
const ISSUE_KEY: Record<Tracker, string> = { jira: "KAN-1", linear: "ENG-1" };
const ACCOUNT_ID = "9001";

describe.skipIf(!TEST_DATABASE_URL)("provider matrix smoke (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");
  let core: typeof import("@sla/core");
  let commitments: typeof import("@sla/commitments");
  let notifications: typeof import("@sla/notifications");
  let sourceSync: typeof import("../src/lib/source-sync");
  let zendesk: typeof import("@sla/zendesk");
  let intercom: typeof import("@sla/intercom");
  let jira: typeof import("@sla/jira");
  let linear: typeof import("@sla/linear");
  let postMessage: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
    core = await import("@sla/core");
    commitments = await import("@sla/commitments");
    notifications = await import("@sla/notifications");
    sourceSync = await import("../src/lib/source-sync");
    zendesk = await import("@sla/zendesk");
    intercom = await import("@sla/intercom");
    jira = await import("@sla/jira");
    linear = await import("@sla/linear");
    postMessage = (await import("@sla/slack")).postMessage as ReturnType<typeof vi.fn>;
  });

  beforeEach(async () => {
    postMessage.mockReset();
    postMessage.mockResolvedValue(undefined);

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const done = { backfillCompletedAt: new Date().toISOString() };

  async function raw(integrationId: string, input: { providerEventId: string; sourceHash: string; payload: unknown }) {
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: input.providerEventId,
        sourceHash: input.sourceHash,
        payload: input.payload as never,
      },
    });
  }

  /** The URL the tracker holds for the ticket source's case, in that provider's own shape. */
  function caseUrl(source: TicketSource, externalId: string) {
    return source === "zendesk"
      ? `https://matrix.zendesk.com/agent/tickets/${externalId}`
      : `https://app.intercom.com/a/apps/matrix-ws/conversations/${externalId}`;
  }

  async function seedTicketSource(source: TicketSource, integrationId: string, openedAt: Date): Promise<string> {
    if (source === "zendesk") {
      await raw(integrationId, zendesk.mapOrganizationToRawEvent({ id: Number(ACCOUNT_ID), name: "Acme Corp" } as never));
      await raw(
        integrationId,
        zendesk.mapTicketToRawEvent({
          id: 501,
          subject: "Checkout button does nothing",
          created_at: openedAt.toISOString(),
          updated_at: openedAt.toISOString(),
          status: "open",
          priority: "normal",
          organization_id: Number(ACCOUNT_ID),
          requester_id: 900,
          via: { channel: "web" },
          tags: [],
        } as never),
      );
      return "501";
    }
    const seconds = Math.floor(openedAt.getTime() / 1000);
    await raw(integrationId, intercom.mapCompanyToRawEvent({ id: ACCOUNT_ID, name: "Acme Corp", updated_at: seconds }));
    await raw(
      integrationId,
      intercom.mapContactToRawEvent({ id: "u1", name: "Pat", companies: { data: [{ id: ACCOUNT_ID }] } }),
    );
    await raw(
      integrationId,
      intercom.mapConversationToRawEvent({
        id: "7001",
        created_at: seconds,
        updated_at: seconds,
        state: "open",
        source: { type: "conversation", author: { type: "user", id: "u1" } },
        contacts: { contacts: [{ id: "u1" }] },
      } as never),
    );
    return "7001";
  }

  async function seedTrackerLink(tracker: Tracker, integrationId: string, url: string) {
    if (tracker === "jira") {
      await raw(integrationId, jira.mapRemoteLinkToRawEvent(ISSUE_KEY.jira, { id: 1, self: "s", object: { url, title: "t" } } as never));
      return;
    }
    await raw(integrationId, linear.mapIssueToRawEvent({ id: "iss1", identifier: ISSUE_KEY.linear, url: "https://linear.app/x/issue/ENG-1" } as never));
    await raw(integrationId, linear.mapAttachmentToRawEvent("iss1", { id: "att1", url, title: "t" } as never));
  }

  describe.each(PAIRS)("$source + $tracker ($role)", ({ source, tracker }) => {
    it("runs the chain from backfilled events to a deduplicated breach alert", async () => {
      // ---- org, policy, calendar, Slack (a native catch-all policy: neither provider imports one here) ----
      const organizationId = (await prisma.organization.create({ data: { name: `Matrix ${source}+${tracker}` } })).id;
      const calendar = await prisma.businessCalendar.create({
        data: {
          organizationId,
          name: "24/7",
          versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
        },
        include: { versions: true },
      });
      const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "Default" } });
      await prisma.sLAPolicyVersion.create({
        data: {
          policyId: policy.id,
          version: 1,
          match: {},
          targets: [
            { kind: "first_response", minutes: FIRST_RESPONSE_MINUTES },
            { kind: "resolution", minutes: RESOLUTION_MINUTES },
          ],
          pauseOnStates: [],
          calendarVersionId: calendar.versions[0]!.id,
          warnAtPercent: [50, 80, 95],
          effectiveFrom: new Date(Date.now() - 24 * 60 * 60_000),
        },
      });
      await prisma.slackIntegration.create({
        data: { organizationId, accessToken: "xoxb-matrix", teamId: "T-M", teamName: "Matrix", botUserId: "U-M", channelId: "C-MATRIX" },
      });

      // ---- connected, backfilled integrations ----
      const sourceIntegration = await prisma.integration.create({
        data: {
          organizationId,
          provider: source,
          status: "connected",
          credentials: source === "zendesk" ? { subdomain: "matrix" } : { workspaceId: "matrix-ws" },
          cursor: done,
        },
      });
      const trackerIntegration = await prisma.integration.create({
        data: { organizationId, provider: tracker, status: "connected", credentials: {}, cursor: done },
      });

      // ---- the events a backfill stored: the case, then the tracker issue linking to it ----
      const openedAt = new Date(Date.now() - 10 * 60_000);
      const externalId = await seedTicketSource(source, sourceIntegration.id, openedAt);
      await seedTrackerLink(tracker, trackerIntegration.id, caseUrl(source, externalId));

      // ---- connect-time projection: normalize, correlate, commitments, evaluation ----
      const sync = await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);
      expect(sync.pendingProviders).toEqual([]);
      expect(sync.evaluation).not.toBeNull();
      expect(sync[tracker]?.correlation).toMatchObject({ caseLinksCreated: 1, unmatchedUnrecognizedUrl: 0, unmatchedNoCase: 0 });

      // ---- the case belongs to its source integration ----
      const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId } });
      expect(caseRow).toMatchObject({ system: source, sourceIntegrationId: sourceIntegration.id });
      expect(
        await prisma.case.findUnique({
          where: {
            organizationId_sourceIntegrationId_externalId: {
              organizationId,
              sourceIntegrationId: sourceIntegration.id,
              externalId,
            },
          },
        }),
      ).toMatchObject({ id: caseRow.id });

      // ---- its customer is resolved through CustomerIdentity ----
      const identity = await prisma.customerIdentity.findFirstOrThrow({
        where: { organizationId, provider: source, externalId: ACCOUNT_ID },
      });
      expect(identity.kind).toBe(source === "zendesk" ? "organization" : "company");
      expect(caseRow.customerId).toBe(identity.customerId);
      expect(await prisma.customer.findUniqueOrThrow({ where: { id: identity.customerId } })).toMatchObject({
        organizationId,
        name: "Acme Corp",
      });

      // ---- a certain CaseLink to the tracker issue, and an engineering leg ----
      expect(
        await prisma.caseLink.findFirstOrThrow({ where: { caseId: caseRow.id, system: tracker, confidence: "certain" } }),
      ).toMatchObject({ externalId: ISSUE_KEY[tracker] });

      const events = (await prisma.normalizedEvent.findMany({ where: { caseId: caseRow.id } })).map((row) =>
        commitments.toNormalizedEventDomain(row),
      );
      expect(events.some((e) => e.type === "issue_linked" && e.sourceRole === "work_tracker")).toBe(true);
      const { spans } = core.deriveLegSpans(events, { caseOpenedAt: openedAt.toISOString() });
      expect(spans.some((span) => span.leg === "engineering")).toBe(true);

      // ---- First Response and Resolution are evaluated (on track at creation, breached later) ----
      const created = await prisma.commitment.findMany({ where: { caseId: caseRow.id } });
      expect(created.map((c) => c.kind).sort()).toEqual(["first_response", "resolution"]);

      const breachAsOf = new Date(Date.now() + (RESOLUTION_MINUTES + 30) * 60_000).toISOString();
      const evaluated = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: breachAsOf, scope: "all" });
      const resolution = await prisma.commitment.findFirstOrThrow({ where: { caseId: caseRow.id, kind: "resolution" } });
      const firstResponse = await prisma.commitment.findFirstOrThrow({ where: { caseId: caseRow.id, kind: "first_response" } });
      expect(resolution.status).toBe("breached");
      expect(firstResponse.status).toBe("breached");
      for (const commitment of [resolution, firstResponse]) {
        expect(await prisma.evaluation.count({ where: { commitmentId: commitment.id, status: "breached" } })).toBeGreaterThan(0);
      }

      // ---- one deduplicated alert ----
      const candidate = evaluated.notificationCandidates.filter((c) => c.commitmentId === resolution.id && c.threshold === 100);
      expect(candidate).toHaveLength(1);

      const claims = await notifications.claimNotifications(prisma, organizationId, evaluated.notificationCandidates, {
        appUrl: "http://localhost:3000",
      });
      expect(claims.claimed.filter((c) => c.candidate.commitmentId === resolution.id && c.candidate.threshold === 100)).toHaveLength(1);
      const sent = await notifications.deliverClaimedNotifications(prisma, claims);
      expect(sent.notificationsSent).toBeGreaterThanOrEqual(1);
      expect(postMessage).toHaveBeenCalledWith("xoxb-matrix", "C-MATRIX", expect.any(String));

      const again = await notifications.claimNotifications(prisma, organizationId, evaluated.notificationCandidates, {
        appUrl: "http://localhost:3000",
      });
      expect(again.claimed).toHaveLength(0);
      expect(await prisma.notification.count({ where: { commitmentId: resolution.id, threshold: 100 } })).toBe(1);
    });
  });
});
