/**
 * Roadmap 1.3 — end-to-end test matrix: starting from raw Zendesk ticket/
 * audit payloads (not hand-built `NormalizedEvent` rows), running the real
 * chain normalization -> commitment matching -> re-resolution -> next-reply
 * cycles -> evaluation -> notification, and asserting the result at the end
 * of that chain.
 *
 * `commitment-re-resolution.test.ts` already covers this engine's rules at
 * the pipeline-function level, seeded with hand-built `NormalizedEvent`
 * rows and direct `Case.update` calls. This suite instead drives everything
 * from `RawEvent` snapshots shaped exactly like a real Zendesk ticket/audit
 * fetch, through the real `runZendeskNormalization`, so a policy-driving
 * attribute change is picked up from a re-ingested ticket snapshot (as it
 * would be from a real poll or webhook), not written directly onto `Case`.
 *
 * Real Postgres, like commitment-re-resolution.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { CommitmentKind, Prisma, PrismaClient } from "@sla/db";
import type {
  ZendeskAudit,
  ZendeskOrganization,
  ZendeskTicket,
} from "@sla/zendesk";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { normalizeZendesk } from "./ingest-helpers";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const SUBDOMAIN = "matrix";
const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);
const iso = (time: string) => at(time).toISOString();

describe.skipIf(!TEST_DATABASE_URL)(
  "SLA end-to-end test matrix: Zendesk audits -> notification (real Postgres)",
  () => {
    let prisma: PrismaClient;
    let commitments: typeof import("@sla/commitments");
    let notifications: typeof import("@sla/notifications");
    let zendesk: typeof import("@sla/zendesk");
    let postMessage: ReturnType<typeof vi.fn>;

    let organizationId: string;
    let integrationId: string;
    let calendar247Id: string;

    beforeAll(async () => {
      const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
      if (!/test/i.test(name)) {
        throw new Error(
          `TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`,
        );
      }
      process.env.DATABASE_URL = TEST_DATABASE_URL;
      prisma = (await import("@sla/db")).getPrismaClient();
      commitments = await import("@sla/commitments");
      notifications = await import("@sla/notifications");
      zendesk = await import("@sla/zendesk");
      postMessage = (await import("@sla/slack")).postMessage as ReturnType<
        typeof vi.fn
      >;
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

      const organization = await prisma.organization.create({
        data: { name: "Matrix Org" },
      });
      organizationId = organization.id;
      const integration = await prisma.integration.create({
        data: {
          organizationId,
          provider: "zendesk",
          credentials: { subdomain: SUBDOMAIN },
          lastSuccessfulSyncAt: new Date(),
        },
      });
      integrationId = integration.id;
      const calendar = await prisma.businessCalendar.create({
        data: {
          organizationId,
          name: "24/7",
          versions: {
            create: {
              version: 1,
              timezone: "UTC",
              weekly: [],
              holidays: [],
              alwaysOpen: true,
            },
          },
        },
        include: { versions: true },
      });
      calendar247Id = calendar.versions[0]!.id;
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    // ---- Zendesk fixture builders -------------------------------------------------

    function ticket(
      id: number,
      overrides: Partial<ZendeskTicket> = {},
    ): ZendeskTicket {
      return {
        id,
        url: `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/${id}.json`,
        external_id: null,
        subject: `Ticket ${id}`,
        created_at: iso("10:00"),
        updated_at: iso("10:00"),
        status: "open",
        priority: "normal",
        organization_id: null,
        requester_id: 900,
        via: { channel: "web" },
        ...overrides,
      };
    }

    function organization(id: number, name: string): ZendeskOrganization {
      return { id, name, updated_at: iso("00:00") };
    }

    let nextAuditId = 1;
    function statusAudit(
      ticketId: number,
      time: string,
      from: string,
      to: string,
    ): ZendeskAudit {
      const id = nextAuditId++;
      return {
        id,
        ticket_id: ticketId,
        created_at: iso(time),
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
        ],
      };
    }

    function replyAudit(
      ticketId: number,
      time: string,
      authorRole: "agent" | "customer",
    ): ZendeskAudit {
      const id = nextAuditId++;
      const authorId = authorRole === "agent" ? 500 : 900;
      return {
        id,
        ticket_id: ticketId,
        created_at: iso(time),
        author_id: authorId,
        via: { channel: "web" },
        events: [
          {
            id: id * 10,
            type: "Comment",
            public: true,
            author_id: authorId,
            plain_body: "reply",
          },
        ],
      };
    }

    /** Writes ticket/organization/audit snapshots as real `RawEvent` rows, then runs the real normalizer. */
    async function ingest(input: {
      tickets?: ZendeskTicket[];
      organizations?: ZendeskOrganization[];
      audits?: ZendeskAudit[];
    }) {
      const inputs = [
        ...(input.tickets ?? []).map((t) => zendesk.mapTicketToRawEvent(t)),
        ...(input.organizations ?? []).map(zendesk.mapOrganizationToRawEvent),
        ...(input.audits ?? []).map(zendesk.mapAuditToRawEvent),
      ];
      if (inputs.length > 0) {
        await prisma.rawEvent.createMany({
          data: inputs.map((i) => ({
            integrationId,
            providerEventId: i.providerEventId,
            sourceHash: i.sourceHash,
            payload: i.payload as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      }
      return normalizeZendesk(prisma, integrationId);
    }

    async function createPolicy(
      name: string,
      match: Record<string, unknown>,
      targets: { kind: string; minutes: number }[],
      overrides: Record<string, unknown> = {},
    ) {
      const policy = await prisma.sLAPolicy.create({
        data: { organizationId, name },
      });
      return prisma.sLAPolicyVersion.create({
        data: {
          policyId: policy.id,
          version: 1,
          match: match as Prisma.InputJsonValue,
          targets: targets as unknown as Prisma.InputJsonValue,
          pauseOnStates: [],
          calendarVersionId: calendar247Id,
          warnAtPercent: [50, 80, 95],
          effectiveFrom: at("00:00"),
          ...overrides,
        },
      });
    }

    const commitmentRow = (caseId: string, kind: CommitmentKind) =>
      prisma.commitment.findFirstOrThrow({ where: { caseId, kind } });

    const auditRows = (commitmentId: string) =>
      prisma.commitmentPolicyChange.findMany({
        where: { commitmentId },
        orderBy: { changedAt: "asc" },
      });

    /** Runs every stage after normalization, in `runCycle`'s own order, with an explicit `asOf`. */
    async function runPipelineStages(asOf: string) {
      const created = await commitments.runCommitmentPipeline(
        prisma,
        organizationId,
      );
      const reResolved = await commitments.runCommitmentReResolutionPipeline(
        prisma,
        organizationId,
        { asOf },
      );
      const cycles = await commitments.runNextReplyCyclePipeline(
        prisma,
        organizationId,
        { asOf },
      );
      const evaluated = await commitments.runEvaluationPipeline(
        prisma,
        organizationId,
        { asOf, scope: "all" },
      );
      const sent = await notifications.runNotificationPipeline(
        prisma,
        organizationId,
        evaluated.notificationCandidates,
        {
          appUrl: "http://localhost:3000",
        },
      );
      return { created, reResolved, cycles, evaluated, sent };
    }

    async function caseByExternalId(externalId: string) {
      return prisma.case.findFirstOrThrow({
        where: { organizationId, externalId: String(externalId) },
      });
    }

    // ---- 1: normal -> high (Resolution 2h -> 8h) ------------------------------------

    it("normal -> high: a resolution commitment already 40m into a 2h target survives an upgrade to an 8h target instead of breaching", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [
        { kind: "resolution", minutes: 120 },
      ]);
      const high = await createPolicy("High", { priority: ["high"] }, [
        { kind: "resolution", minutes: 480 },
      ]);
      const t = ticket(1, { priority: "normal" });
      await ingest({ tickets: [t] });
      await runPipelineStages(iso("10:00"));

      const zCase = await caseByExternalId("1");
      let row = await commitmentRow(zCase.id, "resolution");
      expect(row).toMatchObject({
        policyVersionId: normal.id,
        targetMinutes: 120,
      });

      // 40 minutes in, the customer escalates and the ticket is re-fetched at "high".
      await ingest({
        tickets: [ticket(1, { priority: "high", updated_at: iso("10:40") })],
      });
      const { reResolved, evaluated } = await runPipelineStages(iso("12:10")); // 130 min elapsed: > 2h target, < 8h target
      expect(reResolved.commitmentsUpdated).toBe(1);

      row = await commitmentRow(zCase.id, "resolution");
      expect(row).toMatchObject({
        policyVersionId: high.id,
        targetMinutes: 480,
        status: "on_track",
      });
      expect(evaluated.commitmentsFinalized).toBe(0); // still open — no closing event

      const audits = await auditRows(row.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        previousPolicyVersionId: normal.id,
        newPolicyVersionId: high.id,
        previousTargetMinutes: 120,
        newTargetMinutes: 480,
        reason: "policy_switched",
      });
    });

    // ---- 2: high -> normal (Resolution 8h -> 2h) ------------------------------------

    it("high -> normal: a downgrade immediately breaches a commitment whose elapsed time already exceeds the smaller target", async () => {
      const high = await createPolicy("High", { priority: ["high"] }, [
        { kind: "resolution", minutes: 480 },
      ]);
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [
        { kind: "resolution", minutes: 120 },
      ]);
      const t = ticket(2, { priority: "high" });
      await ingest({ tickets: [t] });
      await runPipelineStages(iso("10:00"));
      expect(
        (await commitmentRow((await caseByExternalId("2")).id, "resolution"))
          .policyVersionId,
      ).toBe(high.id);

      // Downgraded at 130 minutes elapsed — comfortably on_track under the 8h
      // target, but past the smaller 2h target it's about to move onto.
      await ingest({
        tickets: [ticket(2, { priority: "normal", updated_at: iso("12:10") })],
      });
      const { reResolved, evaluated } = await runPipelineStages(iso("12:10"));
      expect(reResolved.commitmentsUpdated).toBe(1);

      const row = await commitmentRow(
        (await caseByExternalId("2")).id,
        "resolution",
      );
      expect(row).toMatchObject({
        policyVersionId: normal.id,
        targetMinutes: 120,
        status: "breached",
      });
      expect(row.closedAt).toBeNull(); // still open, not completed
      expect(evaluated.commitmentsFinalized).toBe(0);
    });

    // ---- 3: normal -> urgent (First Response) ---------------------------------------

    it("normal -> urgent: re-resolves a still-open First Response commitment onto the tighter target, keeping startedAt", async () => {
      const normalPolicy = await createPolicy(
        "Normal",
        { priority: ["normal"] },
        [{ kind: "first_response", minutes: 60 }],
      );
      const urgent = await createPolicy("Urgent", { priority: ["urgent"] }, [
        { kind: "first_response", minutes: 15 },
      ]);
      const t = ticket(3, { priority: "normal" });
      await ingest({ tickets: [t] });
      await runPipelineStages(iso("10:00"));
      const zCase = await caseByExternalId("3");
      expect(
        (await commitmentRow(zCase.id, "first_response")).policyVersionId,
      ).toBe(normalPolicy.id);

      await ingest({
        tickets: [ticket(3, { priority: "urgent", updated_at: iso("10:05") })],
      });
      const { reResolved } = await runPipelineStages(iso("10:05"));
      expect(reResolved.commitmentsUpdated).toBe(1);

      const row = await commitmentRow(zCase.id, "first_response");
      expect(row).toMatchObject({
        policyVersionId: urgent.id,
        targetMinutes: 15,
        startedAt: at("10:00"),
      });
    });

    // ---- 4: customer/organization change; the new policy has no target for this kind

    it("customer/organization change onto a policy with no target for this commitment kind leaves it unchanged and flags it", async () => {
      const defaultPolicy = await createPolicy("Default", {}, [
        { kind: "resolution", minutes: 480 },
      ]);
      const acme = organization(9001, "Acme");
      await ingest({ organizations: [acme] });
      const acmeCustomer = await prisma.customer.findFirstOrThrow({
        where: { organizationId, identities: { some: { provider: "zendesk", kind: "organization", externalId: "9001" } } },
      });
      // Acme's policy only ever configured a First Response target.
      await createPolicy("Acme", { customerIds: [acmeCustomer.id] }, [
        { kind: "first_response", minutes: 30 },
      ]);

      const t = ticket(4, { organization_id: null });
      await ingest({ tickets: [t] });
      await runPipelineStages(iso("10:00"));
      const zCase = await caseByExternalId("4");
      const before = await commitmentRow(zCase.id, "resolution");
      expect(before.policyVersionId).toBe(defaultPolicy.id);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await ingest({
        tickets: [
          ticket(4, { organization_id: 9001, updated_at: iso("10:15") }),
        ],
      });
      const { reResolved } = await runPipelineStages(iso("10:15"));
      expect(reResolved.commitmentsUpdated).toBe(0);
      expect(reResolved.commitmentsMissingTarget).toBe(1);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();

      const after = await commitmentRow(zCase.id, "resolution");
      expect(after).toMatchObject({
        policyVersionId: defaultPolicy.id,
        targetMinutes: 480,
      });
      expect(await auditRows(after.id)).toEqual([]);
    });

    // ---- 5: finished commitments never change ---------------------------------------

    describe("finished commitments never change", () => {
      it("a met commitment is untouched by a later priority change", async () => {
        const normalPolicy = await createPolicy(
          "Normal",
          { priority: ["normal"] },
          [{ kind: "first_response", minutes: 60 }],
        );
        await createPolicy("Urgent", { priority: ["urgent"] }, [
          { kind: "first_response", minutes: 15 },
        ]);
        const t = ticket(51, { priority: "normal" });
        await ingest({
          tickets: [t],
          audits: [replyAudit(51, "10:20", "agent")],
        });
        await runPipelineStages(iso("10:20"));
        const zCase = await caseByExternalId("51");
        const before = await commitmentRow(zCase.id, "first_response");
        expect(before.status).toBe("met");

        await ingest({
          tickets: [
            ticket(51, { priority: "urgent", updated_at: iso("10:30") }),
          ],
        });
        const { reResolved } = await runPipelineStages(iso("10:30"));
        expect(reResolved.commitmentsUpdated).toBe(0);
        const after = await commitmentRow(zCase.id, "first_response");
        expect(after).toMatchObject({
          policyVersionId: before.policyVersionId,
          status: "met",
          closedAt: before.closedAt,
        });
      });

      it("a closed-and-breached commitment is untouched by a later priority change", async () => {
        const normalPolicy = await createPolicy(
          "Normal",
          { priority: ["normal"] },
          [{ kind: "resolution", minutes: 30 }],
        );
        await createPolicy("Urgent", { priority: ["urgent"] }, [
          { kind: "resolution", minutes: 480 },
        ]);
        const t = ticket(52, { priority: "normal" });
        // Closes at 60 min > 30 min target: breached, then closed.
        await ingest({
          tickets: [t],
          audits: [statusAudit(52, "11:00", "open", "solved")],
        });
        await ingest({
          tickets: [
            ticket(52, {
              priority: "normal",
              status: "solved",
              updated_at: iso("11:00"),
            }),
          ],
        });
        await runPipelineStages(iso("11:05"));
        const zCase = await caseByExternalId("52");
        const before = await commitmentRow(zCase.id, "resolution");
        expect(before).toMatchObject({
          status: "breached",
          policyVersionId: normalPolicy.id,
        });
        expect(before.closedAt).not.toBeNull();

        await ingest({
          tickets: [
            ticket(52, {
              priority: "urgent",
              status: "solved",
              updated_at: iso("11:10"),
            }),
          ],
        });
        const { reResolved } = await runPipelineStages(iso("11:10"));
        expect(reResolved.commitmentsUpdated).toBe(0);
        const after = await commitmentRow(zCase.id, "resolution");
        expect(after).toMatchObject({
          policyVersionId: before.policyVersionId,
          status: "breached",
          closedAt: before.closedAt,
        });
      });

      it("a cancelled commitment is untouched by a later priority change", async () => {
        const normalPolicy = await createPolicy(
          "Normal",
          { priority: ["normal"] },
          [{ kind: "next_reply", minutes: 60 }],
        );
        await createPolicy("Urgent", { priority: ["urgent"] }, [
          { kind: "next_reply", minutes: 15 },
        ]);
        const t = ticket(53, { priority: "normal" });
        await ingest({ tickets: [t] });
        const zCase = await caseByExternalId("53");
        const cancelled = await prisma.commitment.create({
          data: {
            caseId: zCase.id,
            kind: "next_reply",
            cycleKey:
              "next_reply:zendesk:raw_1:customer_replied:2026-09-17T09:00:00.000Z",
            policyVersionId: normalPolicy.id,
            calendarVersionId: calendar247Id,
            startedAt: at("09:00"),
            targetMinutes: 60,
            dueAt: at("10:00"),
            status: "cancelled",
            closedAt: at("09:30"),
          },
        });

        await ingest({
          tickets: [
            ticket(53, { priority: "urgent", updated_at: iso("10:00") }),
          ],
        });
        const { reResolved } = await runPipelineStages(iso("10:00"));
        expect(reResolved.commitmentsUpdated).toBe(0);
        const after = await prisma.commitment.findUniqueOrThrow({
          where: { id: cancelled.id },
        });
        expect(after).toMatchObject({
          status: "cancelled",
          policyVersionId: normalPolicy.id,
          targetMinutes: 60,
        });
      });
    });

    // ---- 6: breached, then the target increases: stays breached ---------------------

    it("a breach is final: a still-open breached commitment stays breached after the matched target increases", async () => {
      const normalPolicy = await createPolicy(
        "Normal",
        { priority: ["normal"] },
        [{ kind: "resolution", minutes: 30 }],
      );
      await createPolicy("Urgent", { priority: ["urgent"] }, [
        { kind: "resolution", minutes: 480 },
      ]);
      const t = ticket(6, { priority: "normal" });
      await ingest({ tickets: [t] });
      await runPipelineStages(iso("10:00"));
      // 45 elapsed minutes > 30-minute target; the ticket is still open (no closing event).
      await runPipelineStages(iso("10:45"));
      const zCase = await caseByExternalId("6");
      const before = await commitmentRow(zCase.id, "resolution");
      expect(before).toMatchObject({
        status: "breached",
        policyVersionId: normalPolicy.id,
      });
      expect(before.closedAt).toBeNull();

      // A larger target must never "un-breach" it, even though re-priced time
      // would otherwise put it comfortably on_track.
      await ingest({
        tickets: [ticket(6, { priority: "urgent", updated_at: iso("10:50") })],
      });
      const { reResolved } = await runPipelineStages(iso("10:50"));
      expect(reResolved.commitmentsUpdated).toBe(0);

      const after = await commitmentRow(zCase.id, "resolution");
      expect(after).toMatchObject({
        status: "breached",
        policyVersionId: before.policyVersionId,
        targetMinutes: before.targetMinutes,
      });
      expect(await auditRows(before.id)).toEqual([]);
    });

    // ---- 7: calendar change (D1b) + an open Next Reply cycle and a future cycle -----

    it("D1b: a calendar reassignment alone never re-resolves, but a genuine policy switch carries its calendar into an open cycle and a future one", async () => {
      const narrowCalendar = await prisma.businessCalendar.create({
        data: {
          organizationId,
          name: "Thursday 00:00-00:30 only",
          versions: {
            // 2026-09-17 is a Thursday (weekday 4).
            create: {
              version: 1,
              timezone: "UTC",
              weekly: [{ day: 4, openMinute: 0, closeMinute: 30 }],
              holidays: [],
              alwaysOpen: false,
            },
          },
        },
        include: { versions: true },
      });
      const narrowCalendarVersionId = narrowCalendar.versions[0]!.id;

      const normalPolicy = await createPolicy(
        "Normal",
        { priority: ["normal"] },
        [
          { kind: "resolution", minutes: 480 },
          { kind: "next_reply", minutes: 120 },
        ],
      );
      const urgent = await createPolicy(
        "Urgent",
        { priority: ["urgent"] },
        [
          { kind: "resolution", minutes: 60 },
          { kind: "next_reply", minutes: 45 },
        ],
        { calendarVersionId: narrowCalendarVersionId },
      );

      const acme = organization(9002, "Acme");
      await ingest({ organizations: [acme] });
      const acmeCustomer = await prisma.customer.findFirstOrThrow({
        where: { organizationId, identities: { some: { provider: "zendesk", kind: "organization", externalId: "9002" } } },
      });

      const t = ticket(7, { priority: "normal", organization_id: 9002 });
      await ingest({
        tickets: [t],
        audits: [
          replyAudit(7, "10:15", "agent"),
          replyAudit(7, "10:30", "customer"),
        ],
      });
      await runPipelineStages(iso("10:30")); // creates the Resolution anchor and opens a Next Reply cycle
      const zCase = await caseByExternalId("7");
      const anchorBefore = await commitmentRow(zCase.id, "resolution");
      const cycleBefore = await commitmentRow(zCase.id, "next_reply");
      expect(anchorBefore.calendarVersionId).toBe(calendar247Id);
      expect(cycleBefore).toMatchObject({
        status: "on_track",
        policyVersionId: normalPolicy.id,
        targetMinutes: 120,
      });

      // D1b: reassigning the customer's calendar alone must not re-resolve anything.
      await prisma.customer.update({
        where: { id: acmeCustomer.id },
        data: { calendarId: narrowCalendar.id },
      });
      const calendarOnly = await runPipelineStages(iso("10:35"));
      expect(calendarOnly.reResolved.commitmentsUpdated).toBe(0);
      expect(
        (await commitmentRow(zCase.id, "resolution")).calendarVersionId,
      ).toBe(calendar247Id);
      expect(
        (await commitmentRow(zCase.id, "next_reply")).calendarVersionId,
      ).toBe(calendar247Id);

      // A genuine policy switch (priority change) re-resolves both the still-active
      // anchor and the still-open cycle in place, carrying the new policy's calendar.
      await ingest({
        tickets: [
          ticket(7, {
            priority: "urgent",
            organization_id: 9002,
            updated_at: iso("10:40"),
          }),
        ],
      });
      const switched = await runPipelineStages(iso("10:40"));
      expect(switched.reResolved.commitmentsUpdated).toBe(2);

      const anchorAfter = await commitmentRow(zCase.id, "resolution");
      expect(anchorAfter).toMatchObject({
        id: anchorBefore.id,
        policyVersionId: urgent.id,
        targetMinutes: 60,
        calendarVersionId: narrowCalendarVersionId,
      });
      const cycleAfter = await commitmentRow(zCase.id, "next_reply");
      expect(cycleAfter).toMatchObject({
        id: cycleBefore.id,
        cycleKey: cycleBefore.cycleKey,
        startedAt: cycleBefore.startedAt,
        policyVersionId: urgent.id,
        targetMinutes: 45,
        calendarVersionId: narrowCalendarVersionId,
      });

      // The first cycle is answered, and a second customer reply opens a future
      // cycle — created fresh under the already re-resolved anchor policy.
      await ingest({
        tickets: [
          ticket(7, {
            priority: "urgent",
            organization_id: 9002,
            updated_at: iso("10:45"),
          }),
        ],
        audits: [replyAudit(7, "10:45", "agent")],
      });
      await runPipelineStages(iso("10:45"));
      await ingest({
        tickets: [
          ticket(7, {
            priority: "urgent",
            organization_id: 9002,
            updated_at: iso("11:00"),
          }),
        ],
        audits: [replyAudit(7, "11:00", "customer")],
      });
      await runPipelineStages(iso("11:00"));

      const cycleRows = await prisma.commitment.findMany({
        where: { caseId: zCase.id, kind: "next_reply" },
        orderBy: { startedAt: "asc" },
      });
      expect(cycleRows).toHaveLength(2);
      expect(cycleRows[1]).toMatchObject({
        startedAt: at("11:00"),
        policyVersionId: urgent.id,
        targetMinutes: 45,
        calendarVersionId: narrowCalendarVersionId,
      });
    });

    // ---- notification: the chain's last stage ---------------------------------------

    it("a breach reached through re-resolution reaches the notification stage and sends exactly one Slack alert", async () => {
      await prisma.slackIntegration.create({
        data: {
          organizationId,
          accessToken: "xoxb-test",
          teamId: "T123",
          teamName: "Matrix",
          botUserId: "U123",
          channelId: "C123",
        },
      });

      const normalPolicy = await createPolicy(
        "Normal",
        { priority: ["normal"] },
        [{ kind: "resolution", minutes: 480 }],
      );
      await createPolicy("Urgent", { priority: ["urgent"] }, [
        { kind: "resolution", minutes: 30 },
      ]);
      const t = ticket(8, { priority: "normal" });
      await ingest({ tickets: [t] });
      await runPipelineStages(iso("10:00"));
      expect(
        (await commitmentRow((await caseByExternalId("8")).id, "resolution"))
          .policyVersionId,
      ).toBe(normalPolicy.id);

      // Escalating to Urgent's 30-minute target after 45 elapsed minutes breaches outright.
      await ingest({
        tickets: [ticket(8, { priority: "urgent", updated_at: iso("10:45") })],
      });
      const { sent, evaluated } = await runPipelineStages(iso("10:45"));

      const zCase = await caseByExternalId("8");
      const row = await commitmentRow(zCase.id, "resolution");
      expect(row.status).toBe("breached");
      expect(evaluated.notificationCandidates).toEqual([
        expect.objectContaining({
          commitmentId: row.id,
          threshold: 100,
          status: "breached",
        }),
      ]);
      expect(sent.notificationsSent).toBe(1);
      expect(postMessage).toHaveBeenCalledTimes(1);

      const notificationRow = await prisma.notification.findFirstOrThrow({
        where: { commitmentId: row.id },
      });
      expect(notificationRow).toMatchObject({
        threshold: 100,
        channel: "slack",
      });

      // Re-running the same asOf sends nothing new — the dedup on (commitmentId, threshold) holds.
      const again = await runPipelineStages(iso("10:45"));
      expect(again.sent.notificationsSent).toBe(0);
      expect(postMessage).toHaveBeenCalledTimes(1);
    });
  },
);
