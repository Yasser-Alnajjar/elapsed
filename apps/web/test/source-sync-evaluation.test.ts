/**
 * Regression suite for the connect/backfill routes leaving freshly imported
 * commitments at their defaults (`on_track`, `closedAt: null`, no Evaluation)
 * until the worker's next poll — which surfaced as a met ticket reading
 * "On track" and a breached one sitting in "At risk now".
 *
 * Real Postgres, like tenant-isolation.test.ts: the bug lived in which
 * pipelines ran and in what order, so a fake Prisma would prove nothing. Only
 * the provider HTTP fetches are replaced — each writes the RawEvents a real
 * backfill would and marks its cursor complete. Normalization, correlation,
 * policy import, commitments, evaluation and the worker cycle are all real.
 *
 * Needs a migrated Postgres at TEST_DATABASE_URL; skipped when unset. The
 * database name must contain "test", because every test truncates all tables.
 */
import type { Session } from "next-auth";
import type { Prisma, PrismaClient } from "@sla/db";
import type {
  ZendeskAudit,
  ZendeskSlaPolicy,
  ZendeskTicket,
  ZendeskUser,
} from "@sla/zendesk";
import type {
  JiraChangelogHistory,
  JiraIssue,
  JiraRemoteLink,
  JiraStatus,
} from "@sla/jira";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const auth = vi.hoisted(() => ({ session: null as Session | null }));
/** Resolved-on-demand gates, so a test can hold one provider's fetch open while the other route runs. */
const gates = vi.hoisted(() => ({ jiraFetch: null as Promise<void> | null }));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => auth.session),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/zendesk-env", () => ({
  getZendeskOAuthConfig: vi.fn(async () => ({})),
}));
vi.mock("@/lib/jira-env", () => ({
  getJiraOAuthConfig: vi.fn(async () => ({})),
}));
vi.mock("../../worker/src/sentry", () => ({ captureException: vi.fn() }));

vi.mock("@sla/zendesk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sla/zendesk")>();
  return {
    ...actual,
    runZendeskBackfill: vi.fn(
      async (prisma: PrismaClient, integrationId: string) => {
        const inputs = [
          // Explicit wrapper: `mapTicketToRawEvent` now takes an optional
          // second `users` (sideload) argument, so passing it to `.map`
          // directly would leak the array index into that parameter.
          ...zendeskFixture.tickets.map((ticket) =>
            actual.mapTicketToRawEvent(ticket),
          ),
          ...zendeskFixture.audits.map(actual.mapAuditToRawEvent),
          ...zendeskFixture.slaPolicies.map(actual.mapSlaPolicyToRawEvent),
          // D5b needs to tell a customer-created ticket from an agent-created
          // one: without a role sideload, `resolveActor` falls back to
          // guessing off `ticket.requester_id`, and the fixture's own status
          // audits are all authored by the agent (500), which would otherwise
          // misattribute ticket creation to the agent.
          ...zendeskFixture.users.map(actual.mapUserToRawEvent),
        ];
        await writeFetch(prisma, integrationId, inputs, {
          tickets: { startTime: 1 },
          organizations: { startTime: 1 },
        });
        return {};
      },
    ),
  };
});

vi.mock("@sla/jira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sla/jira")>();
  return {
    ...actual,
    runJiraBackfill: vi.fn(
      async (prisma: PrismaClient, integrationId: string) => {
        if (gates.jiraFetch) await gates.jiraFetch;
        const inputs = [
          ...jiraFixture.statuses.map(actual.mapStatusToRawEvent),
          actual.mapIssueToRawEvent(jiraFixture.issue),
          ...jiraFixture.histories.map((h) =>
            actual.mapChangelogHistoryToRawEvent(jiraFixture.issue.key, h),
          ),
          actual.mapRemoteLinkToRawEvent(
            jiraFixture.issue.key,
            jiraFixture.remoteLink,
          ),
        ];
        await writeFetch(prisma, integrationId, inputs, {
          issues: { updatedSince: "2026-03-01T00:00:00.000Z" },
        });
        return {};
      },
    ),
  };
});

async function writeFetch(
  prisma: PrismaClient,
  integrationId: string,
  inputs: { providerEventId: string; sourceHash: string; payload: unknown }[],
  cursor: Record<string, unknown>,
): Promise<void> {
  await prisma.rawEvent.createMany({
    data: inputs.map((input) => ({
      integrationId,
      providerEventId: input.providerEventId,
      sourceHash: input.sourceHash,
      payload: input.payload as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  await prisma.integration.update({
    where: { id: integrationId },
    data: {
      cursor: { ...cursor, backfillCompletedAt: new Date().toISOString() },
    },
  });
}

const SUBDOMAIN = "acme";
const minutes = (base: string, n: number) =>
  new Date(Date.parse(base) + n * 60_000).toISOString();

const MET_OPENED = "2026-03-02T09:00:00.000Z";
const BREACHED_OPENED = "2026-03-03T09:00:00.000Z";
const LINKED_OPENED = "2026-03-04T09:00:00.000Z";

function ticket(
  id: number,
  createdAt: string,
  updatedAt: string,
): ZendeskTicket {
  return {
    id,
    url: `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/${id}.json`,
    external_id: null,
    subject: `Ticket ${id}`,
    created_at: createdAt,
    updated_at: updatedAt,
    status: "solved",
    priority: "normal",
    organization_id: null,
    requester_id: 900,
    via: { channel: "web" },
  };
}

function statusAudit(
  id: number,
  ticketId: number,
  createdAt: string,
  from: string,
  to: string,
  extraEvents: ZendeskAudit["events"] = [],
): ZendeskAudit {
  return {
    id,
    ticket_id: ticketId,
    created_at: createdAt,
    author_id: 500,
    via: { channel: "web" },
    events: [
      {
        id: id * 10,
        type: "Change",
        field_name: "status",
        previous_value: from,
        value: to,
      },
      ...extraEvents,
    ],
  };
}

/**
 * The ticket's own creation transition ("new" → "open"), authored by the
 * requester (customer): without it, `deriveNormalizedEventsForTicket` falls
 * back to the earliest status-change audit to decide `case_created`'s actor
 * (D5b) — which would otherwise be the agent's own "open" → "pending"/"solved"
 * transition below, misattributing these customer-submitted tickets as
 * agent-created and blocking their first-response commitment from ever
 * starting.
 */
function creationAudit(
  id: number,
  ticketId: number,
  createdAt: string,
): ZendeskAudit {
  return {
    id,
    ticket_id: ticketId,
    created_at: createdAt,
    author_id: 900,
    via: { channel: "web" },
    events: [
      {
        id: id * 10,
        type: "Change",
        field_name: "status",
        previous_value: "new",
        value: "open",
      },
    ],
  };
}

const publicComment = (
  id: number,
  authorId: number,
): ZendeskAudit["events"][number] => ({
  id,
  type: "Comment",
  public: true,
  author_id: authorId,
  body: "On it.",
});

/**
 * 60-minute first-reply target on normal priority, calendar time — so each
 * ticket gets only a first-response commitment.
 * - #101 (met): open → pending after 5m → agent replies and solves at 9m
 *   (D5a: a reply-less close no longer completes first response — the agent's
 *   own public comment on the solving audit does). First response never
 *   pauses (clock-rules.ts), so the pending interval still counts: 9m.
 * - #102 (breached): open → solved after 90m, no reply — still breaches by
 *   elapsed time alone; a reply-less close simply never completes it.
 * - #103: open → pending after 10m → solved at 120m, no reply; linked to
 *   ENG-1, whose history is part of the event set its commitment is
 *   evaluated against.
 */
const zendeskFixture: {
  tickets: ZendeskTicket[];
  audits: ZendeskAudit[];
  slaPolicies: ZendeskSlaPolicy[];
  users: ZendeskUser[];
} = {
  tickets: [
    ticket(101, MET_OPENED, minutes(MET_OPENED, 9)),
    ticket(102, BREACHED_OPENED, minutes(BREACHED_OPENED, 90)),
    ticket(103, LINKED_OPENED, minutes(LINKED_OPENED, 120)),
  ],
  audits: [
    creationAudit(1010, 101, MET_OPENED),
    statusAudit(1011, 101, minutes(MET_OPENED, 5), "open", "pending"),
    // Agent replies and solves in the same audit (D5a: the reply, not the
    // close, is what completes first response).
    statusAudit(1012, 101, minutes(MET_OPENED, 9), "pending", "solved", [
      publicComment(10121, 500),
    ]),
    creationAudit(1020, 102, BREACHED_OPENED),
    statusAudit(1021, 102, minutes(BREACHED_OPENED, 90), "open", "solved"),
    creationAudit(1030, 103, LINKED_OPENED),
    statusAudit(1031, 103, minutes(LINKED_OPENED, 10), "open", "pending"),
    statusAudit(1032, 103, minutes(LINKED_OPENED, 120), "pending", "solved"),
  ],
  // Requester (900) is the customer; the status audits' author (500) is the
  // agent solving the ticket (D5b).
  users: [
    { id: 900, role: "end-user" },
    { id: 500, role: "agent" },
  ],
  slaPolicies: [
    {
      id: 7001,
      title: "Default",
      filter: { all: [], any: [] },
      policy_metrics: [
        {
          priority: "normal",
          metric: "first_reply_time",
          target: 60,
          business_hours: false,
        },
      ],
    },
  ],
};

const jiraFixture: {
  statuses: JiraStatus[];
  issue: JiraIssue;
  histories: JiraChangelogHistory[];
  remoteLink: JiraRemoteLink;
} = {
  statuses: [
    {
      id: "10000",
      name: "To Do",
      statusCategory: { key: "new", name: "To Do" },
    },
    {
      id: "10001",
      name: "In Progress",
      statusCategory: { key: "indeterminate", name: "In Progress" },
    },
  ],
  issue: {
    id: "20001",
    key: "ENG-1",
    self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/20001",
    fields: {
      summary: "Investigate ticket 103",
      status: { id: "10001", name: "In Progress" },
      priority: null,
      project: { id: "1", key: "ENG", name: "Engineering" },
      created: minutes(LINKED_OPENED, 1),
      updated: minutes(LINKED_OPENED, 15),
      reporter: { accountId: "eng-reporter" },
      assignee: null,
    },
  },
  histories: [
    {
      id: "54651",
      author: { accountId: "eng-assignee" },
      created: minutes(LINKED_OPENED, 15),
      items: [
        {
          field: "status",
          fieldtype: "jira",
          from: "10000",
          fromString: "To Do",
          to: "10001",
          toString: "In Progress",
        },
      ],
    },
  ],
  remoteLink: {
    id: 40001,
    self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/ENG-1/remotelink/40001",
    object: {
      url: `https://${SUBDOMAIN}.zendesk.com/agent/tickets/103`,
      title: "Ticket 103",
    },
  },
};

function assertDisposableDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL points at database "${name}". This suite truncates every table, so the name must contain "test".`,
    );
  }
}

describe.skipIf(!TEST_DATABASE_URL)(
  "Zendesk connect evaluates imported commitments (real Postgres)",
  () => {
    let prisma: PrismaClient;
    let organizationId: string;
    let routes: {
      zendeskBackfill: typeof import("../src/app/api/integrations/zendesk/backfill/route");
      jiraBackfill: typeof import("../src/app/api/integrations/jira/backfill/route");
    };
    let runCycle: typeof import("../../worker/src/cycle").runCycle;
    let core: typeof import("@sla/core");
    let commitments: typeof import("@sla/commitments");

    beforeAll(async () => {
      assertDisposableDatabase(TEST_DATABASE_URL!);
      process.env.DATABASE_URL = TEST_DATABASE_URL;
      process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY ??=
        "source-sync-test-integration-key";
      process.env.SMTP_ENCRYPTION_KEY ??= "source-sync-test-smtp-key";

      prisma = (await import("@sla/db")).getPrismaClient();
      routes = {
        zendeskBackfill:
          await import("../src/app/api/integrations/zendesk/backfill/route"),
        jiraBackfill:
          await import("../src/app/api/integrations/jira/backfill/route"),
      };
      runCycle = (await import("../../worker/src/cycle")).runCycle;
      core = await import("@sla/core");
      commitments = await import("@sla/commitments");
    });

    beforeEach(async () => {
      gates.jiraFetch = null;
      const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
      );

      const organization = await prisma.organization.create({
        data: { name: "Acme" },
      });
      organizationId = organization.id;
      const user = await prisma.user.create({
        data: {
          organizationId,
          email: "owner@acme.test",
          passwordHash: "unused",
          role: "owner",
        },
      });
      await prisma.integration.create({
        data: {
          organizationId,
          provider: "zendesk",
          credentials: {
            subdomain: SUBDOMAIN,
            accessToken: "token",
            tokenType: "bearer",
            scope: "read",
          },
        },
      });
      auth.session = {
        expires: new Date(Date.now() + 3_600_000).toISOString(),
        user: {
          id: user.id,
          organizationId,
          email: user.email,
          name: null,
          image: null,
          role: "owner",
          createdAt: new Date(),
        },
      } as Session;
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    async function connectJira() {
      await prisma.integration.create({
        data: {
          organizationId,
          provider: "jira",
          credentials: {
            cloudId: "cloud",
            siteUrl: "https://acme.atlassian.net",
            accessToken: "token",
            tokenType: "bearer",
          },
        },
      });
    }

    async function postZendeskBackfill() {
      const response = await routes.zendeskBackfill.POST();
      expect(response.status).toBe(200);
      return response.json();
    }

    async function postJiraBackfill() {
      const response = await routes.jiraBackfill.POST();
      expect(response.status).toBe(200);
      return response.json();
    }

    async function commitmentFor(ticketId: string) {
      return prisma.commitment.findFirstOrThrow({
        where: { case: { organizationId, externalId: ticketId } },
        include: {
          evaluations: { orderBy: { evaluatedAt: "asc" } },
          case: true,
        },
      });
    }

    /** Every commitment/evaluation/event row that a re-run must leave untouched. */
    async function snapshot() {
      const [commitmentRows, evaluationRows, eventCount] = await Promise.all([
        prisma.commitment.findMany({
          select: { id: true, status: true, closedAt: true },
          orderBy: { id: "asc" },
        }),
        prisma.evaluation.findMany({
          select: { id: true, status: true },
          orderBy: { id: "asc" },
        }),
        prisma.normalizedEvent.count(),
      ]);
      return { commitmentRows, evaluationRows, eventCount };
    }

    /** What `evaluateCommitment` says for this commitment over every event now stored for its case. */
    async function evaluateOverStoredEvents(ticketId: string, asOf: string) {
      const row = await commitmentFor(ticketId);
      const [events, policyVersion, calendar] = await Promise.all([
        prisma.normalizedEvent.findMany({ where: { caseId: row.caseId } }),
        prisma.sLAPolicyVersion.findUniqueOrThrow({
          where: { id: row.policyVersionId },
        }),
        prisma.businessCalendarVersion.findUniqueOrThrow({
          where: { id: row.calendarVersionId },
        }),
      ]);
      return core.evaluateCommitment(
        commitments.toCommitmentDomain(row),
        events.map(commitments.toNormalizedEventDomain),
        {
          id: policyVersion.id,
          policyId: policyVersion.policyId,
          version: policyVersion.version,
          match: policyVersion.match as never,
          targets: policyVersion.targets as never,
          pauseOnStates: policyVersion.pauseOnStates as never,
          calendarVersionId: policyVersion.calendarVersionId,
          warnAtPercent: policyVersion.warnAtPercent,
          effectiveFrom: policyVersion.effectiveFrom.toISOString(),
        },
        { ...calendar, weekly: calendar.weekly as never },
        asOf,
      );
    }

    async function expectNoUnfinalizedTerminalCommitments() {
      const leftovers = await prisma.commitment.findMany({
        where: {
          case: { organizationId, closedAt: { not: null } },
          OR: [{ closedAt: null }, { evaluations: { none: {} } }],
        },
      });
      expect(leftovers).toEqual([]);
    }

    describe("Zendesk only", () => {
      it("finalizes a historically met ticket as met, with closedAt and an Evaluation", async () => {
        const body = await postZendeskBackfill();
        expect(body.pendingProviders).toEqual([]);
        expect(body.evaluation.commitmentsFinalized).toBeGreaterThan(0);

        const met = await commitmentFor("101");
        expect(met.kind).toBe("first_response");
        expect(met.status).toBe("met");
        expect(met.closedAt).not.toBeNull();
        expect(met.evaluations).toHaveLength(1);
        // The 4m spent pending counts: a customer wait doesn't pause first response.
        expect(met.evaluations[0]).toMatchObject({
          status: "met",
          elapsedSeconds: 9 * 60,
        });
      });

      it("finalizes a historically breached ticket as breached, with closedAt and an Evaluation", async () => {
        await postZendeskBackfill();

        const breached = await commitmentFor("102");
        expect(breached.status).toBe("breached");
        expect(breached.closedAt).not.toBeNull();
        expect(breached.evaluations).toHaveLength(1);
        expect(breached.evaluations[0]).toMatchObject({
          status: "breached",
          breachedBySeconds: 30 * 60,
        });
      });

      it("leaves no terminal case with a default on_track / unfinalized / unevaluated commitment", async () => {
        await postZendeskBackfill();

        expect(
          await prisma.commitment.count({
            where: { case: { organizationId } },
          }),
        ).toBe(3);
        await expectNoUnfinalizedTerminalCommitments();
        expect(
          await prisma.commitment.count({ where: { status: "on_track" } }),
        ).toBe(0);
      });

      it("gives the same result the worker would: later active and reconciliation cycles change nothing", async () => {
        await postZendeskBackfill();
        const afterConnect = await snapshot();

        const config = {
          appUrl: "http://localhost:5465",
          healthPort: 0,
          opsAlert: null,
          lockRetryMs: 0,
          lockPingMs: 0,
          organizationConcurrency: 1,
          workerId: "source-sync-test",
          leaseTtlMs: 60_000,
          claimPollMs: 1_000,
          shutdownGraceMs: 0,
          databasePoolMax: 4,
        };
        const active = await runCycle(prisma, config, "active_set_poll");
        const sweep = await runCycle(prisma, config, "reconciliation_sweep");

        expect(active.evaluationsCreated).toBe(0);
        expect(active.commitmentsFinalized).toBe(0);
        expect(sweep.evaluationsCreated).toBe(0);
        expect(sweep.commitmentsFinalized).toBe(0);
        expect(
          active.failures.filter((f) => f.stage !== "ingest:zendesk"),
        ).toEqual([]);
        expect(
          sweep.failures.filter((f) => f.stage !== "ingest:zendesk"),
        ).toEqual([]);
        const afterWorker = await snapshot();
        expect(afterWorker.commitmentRows).toEqual(afterConnect.commitmentRows);
        expect(afterWorker.evaluationRows).toEqual(afterConnect.evaluationRows);
      });

      it("is idempotent: re-running the backfill route and the evaluation pipeline writes nothing new", async () => {
        await postZendeskBackfill();
        const first = await snapshot();

        const rerun = await postZendeskBackfill();
        expect(rerun.evaluation.evaluationsCreated).toBe(0);
        expect(rerun.evaluation.commitmentsFinalized).toBe(0);
        const direct = await commitments.runEvaluationPipeline(
          prisma,
          organizationId,
          { scope: "all" },
        );
        expect(direct.evaluationsCreated).toBe(0);

        expect(await snapshot()).toEqual(first);
      });
    });

    describe("Zendesk and Jira in the same onboarding flow", () => {
      beforeEach(connectJira);

      async function expectFinalizedOverCompleteEventSet() {
        const linked = await commitmentFor("103");
        const jiraEvents = await prisma.normalizedEvent.count({
          where: {
            caseId: linked.caseId,
            system: "jira",
            type: "state_changed",
          },
        });
        expect(jiraEvents).toBeGreaterThan(0);
        expect(linked.closedAt).not.toBeNull();
        expect(linked.evaluations).toHaveLength(1);

        const evaluation = linked.evaluations[0]!;
        const expected = await evaluateOverStoredEvents(
          "103",
          evaluation.evaluatedAt.toISOString(),
        );
        expect(linked.status).toBe(expected.status);
        expect(evaluation).toMatchObject({
          status: expected.status,
          elapsedSeconds: expected.elapsedSeconds,
        });
        await expectNoUnfinalizedTerminalCommitments();
      }

      it("Zendesk finishing first defers evaluation until Jira's backfill completes", async () => {
        const zendeskBody = await postZendeskBackfill();
        expect(zendeskBody.pendingProviders).toEqual(["jira"]);
        expect(zendeskBody.evaluation).toBeNull();
        // Commitments exist, but nothing has been finalized from the partial event set.
        expect(
          await prisma.commitment.count({
            where: { case: { organizationId } },
          }),
        ).toBe(3);
        expect(
          await prisma.commitment.count({ where: { closedAt: { not: null } } }),
        ).toBe(0);
        expect(await prisma.evaluation.count()).toBe(0);

        const jiraBody = await postJiraBackfill();
        expect(jiraBody.pendingProviders).toEqual([]);
        expect(jiraBody.correlation.created).toBe(1);

        await expectFinalizedOverCompleteEventSet();
      });

      it("Jira finishing first (before Zendesk cases exist) defers, then Zendesk re-correlates and evaluates", async () => {
        const jiraBody = await postJiraBackfill();
        expect(jiraBody.pendingProviders).toEqual(["zendesk"]);
        expect(jiraBody.evaluation).toBeNull();
        expect(jiraBody.correlation.unmatched.noCase).toBe(1);

        const zendeskBody = await postZendeskBackfill();
        expect(zendeskBody.pendingProviders).toEqual([]);
        expect(zendeskBody.jira.correlation.created).toBe(1);

        await expectFinalizedOverCompleteEventSet();
      });

      it("concurrent routes converge on the complete event set without duplicate events", async () => {
        let releaseJira!: () => void;
        gates.jiraFetch = new Promise<void>(
          (resolve) => (releaseJira = resolve),
        );

        const zendesk = postZendeskBackfill();
        const jira = postJiraBackfill();
        // Let the Zendesk route finish its fetch, projection and (deferred) evaluation first.
        const zendeskBody = await zendesk;
        expect(zendeskBody.pendingProviders).toEqual(["jira"]);
        expect(await prisma.evaluation.count()).toBe(0);
        releaseJira();
        await jira;

        await expectFinalizedOverCompleteEventSet();
        const duplicates = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM (
          SELECT 1 FROM normalized_events
          GROUP BY "caseId", "sourceRawEventId", type, "occurredAt"
          HAVING count(*) > 1
        ) d`;
        expect(Number(duplicates[0]!.n)).toBe(0);
      });
    });
  },
);
