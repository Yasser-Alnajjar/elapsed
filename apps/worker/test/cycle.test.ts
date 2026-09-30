import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sla/db";
import { runCommitmentPipeline, runEvaluationPipeline, runNextReplyCyclePipeline } from "@sla/commitments";
import { emptyCycleResult, processOrganization, runCycle, type OrganizationRunContext } from "../src/cycle";
import { createLogger } from "@sla/logger";
import { LeaseLostError, type LeaseGuard } from "../src/lease";
import { captureException } from "../src/sentry";
import type { WorkerConfig } from "../src/config";

// Everything downstream of ingestion is out of scope here — stubbed so the
// cycle's per-integration status handling is what's under test.
vi.mock("../src/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@sla/commitments", () => ({
  buildCaseRefResolver: vi.fn().mockResolvedValue(null),
  loadPolicyContext: vi.fn().mockResolvedValue({ policyVersionRows: [], customersWithCalendarOverride: [] }),
  runCommitmentPipeline: vi.fn().mockResolvedValue({ commitmentsCreated: 0 }),
  runCommitmentReResolutionPipeline: vi.fn().mockResolvedValue({
    casesConsidered: 0,
    activeCommitmentsConsidered: 0,
    commitmentsUpdated: 0,
    casesWithNoMatchingPolicy: 0,
    commitmentsMissingTarget: 0,
    casesFailed: [],
  }),
  runNextReplyCyclePipeline: vi.fn().mockResolvedValue({
    casesConsidered: 0,
    cyclesCreated: 0,
    cyclesCancelled: 0,
    cyclesRestored: 0,
    casesFailed: [],
  }),
  runEvaluationPipeline: vi.fn().mockResolvedValue({
    commitmentsConsidered: 0,
    evaluationsCreated: 0,
    commitmentsFinalized: 0,
    notificationCandidates: [],
  }),
}));
vi.mock("@sla/notifications", () => ({
  claimNotifications: vi.fn().mockResolvedValue({ claimed: [], skipped: 0, slack: null, emailConfig: null, emailTo: [] }),
  deliverClaimedNotifications: vi
    .fn()
    .mockResolvedValue({ notificationsSent: 0, notificationsSkipped: 0, notificationsFailed: [] }),
}));
// Linear's *real* backfill, client and token lifecycle run against a stubbed
// `fetch`, so each case below starts from an actual HTTP status code. Only the
// post-ingest DB-heavy stages are stubbed.
vi.mock("@sla/linear", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sla/linear")>()),
  runLinearCorrelation: vi.fn().mockResolvedValue({}),
  runLinearNormalization: vi.fn().mockResolvedValue({}),
}));
// `withOrganizationSlaLock` holds its advisory lock on a dedicated,
// unpooled `pg.Client` (organization-lock.ts), not the injected Prisma
// client — this fake DB has no real Postgres to lock against, so the lock
// itself is stubbed to a passthrough; everything else from @sla/db (the
// `PrismaClient` type) passes through untouched.
vi.mock("@sla/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sla/db")>()),
  withOrganizationSlaLock: vi.fn((_prisma: unknown, _organizationId: string, work: () => Promise<unknown>) => work()),
}));

const captureExceptionMock = vi.mocked(captureException);
const config = { appUrl: "https://app.example.com" } as WorkerConfig;

type Status = "connected" | "disconnected" | "reauth_required" | "permission_denied";

interface Row {
  id: string;
  provider: "linear";
  status: Status;
  credentials: Record<string, unknown>;
  cursor: unknown;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
}

/** A one-integration "database" with the same read/compare-and-set semantics the code relies on. */
function fakeDb(status: Status) {
  const row: Row = {
    id: "int_1",
    provider: "linear",
    status,
    credentials: { accessToken: "token-1", tokenType: "Bearer", scope: "read" },
    cursor: null,
    lastSyncAt: null,
    lastSyncError: null,
  };

  const prisma = {
    organization: {
      findMany: vi.fn(async () => [
        {
          id: "org_1",
          integrations:
            row.status === "disconnected"
              ? []
              : [{ id: row.id, provider: row.provider, credentials: row.credentials, status: row.status }],
        },
      ]),
    },
    integration: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        Object.assign(row, data);
        return { ...row };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: Status; credentials?: { equals: unknown } };
          data: Partial<Row>;
        }) => {
          const matches =
            where.id === row.id &&
            (where.status === undefined || where.status === row.status) &&
            (where.credentials === undefined || JSON.stringify(where.credentials.equals) === JSON.stringify(row.credentials));
          if (!matches) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    rawEvent: { createMany: vi.fn(async () => ({ count: 0 })) },
  };

  return { row, prisma: prisma as unknown as PrismaClient };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const emptyIssuesPage = { data: { issues: { nodes: [], pageInfo: { hasNextPage: false } } } };

function stubFetch(...responses: (() => Response)[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockImplementationOnce(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ORIGINAL_INTEGRATION_TOKEN_ENCRYPTION_KEY = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  captureExceptionMock.mockClear();
  // Linear's real tokenLifecycle (unmocked here) encrypts credentials before
  // every write, including the reauthRequired flag it sets on a 401.
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "test-integration-token-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = ORIGINAL_INTEGRATION_TOKEN_ENCRYPTION_KEY;
});

describe("runCycle — provider permission loss (roadmap step 32)", () => {
  it("HTTP 403 → permission_denied, one Sentry event, no token refresh or retry", async () => {
    const { row, prisma } = fakeDb("connected");
    const fetchMock = stubFetch(() => jsonResponse(403, { errors: [{ message: "Forbidden" }] }));

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(row.status).toBe("permission_denied");
    expect(row.lastSyncError).toBe("Linear denied access — the connecting user's Linear permissions may have changed");
    // Credentials untouched: a 403 is not a token problem.
    expect(row.credentials).toEqual({ accessToken: "token-1", tokenType: "Bearer", scope: "read" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    // Customer-side integration health (recorded on the Integration and in `integrationIssues`),
    // not a failure of the worker: it must not make the run "failed".
    expect(result.failures).toEqual([]);
    expect(result.integrationIssues).toEqual([
      { organizationId: "org_1", provider: "linear", issue: "permission_denied", message: row.lastSyncError },
    ]);
  });

  it("HTTP 401 → existing reauth behavior: reauth_required, credentials flagged, no Sentry event", async () => {
    const { row, prisma } = fakeDb("connected");
    const fetchMock = stubFetch(() => jsonResponse(401, { errors: [{ message: "Authentication required" }] }));

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(row.status).toBe("reauth_required");
    expect(row.lastSyncError).toBe("Linear needs to be reconnected");
    expect(result.failures).toEqual([]);
    expect(result.integrationIssues).toMatchObject([{ provider: "linear", issue: "reauth_required" }]);
    expect(row.credentials.reauthRequired).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("HTTP 500 → existing generic error behavior: status unchanged, raw error recorded, Sentry event", async () => {
    vi.useFakeTimers();
    try {
      const { row, prisma } = fakeDb("connected");
      // A 500 is now retried up to the shared retry policy's attempt cap
      // (roadmap step 0.9) before surfacing as a failure.
      stubFetch(...Array(5).fill(() => jsonResponse(500, { error: "boom" })));

      const pending = runCycle(prisma, config, "active_set_poll");
      await vi.runAllTimersAsync();
      await pending;

      expect(row.status).toBe("connected");
      expect(row.lastSyncError).toBe("Linear API error 500");
      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("permission_denied + successful sync → connected, error cleared", async () => {
    const { row, prisma } = fakeDb("permission_denied");
    stubFetch(() => jsonResponse(200, emptyIssuesPage));

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(row.status).toBe("connected");
    expect(row.lastSyncError).toBeNull();
    expect(result.failures).toEqual([]);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("a transient failure while permission_denied neither clears nor changes the status", async () => {
    vi.useFakeTimers();
    try {
      const { row, prisma } = fakeDb("permission_denied");
      stubFetch(...Array(5).fill(() => jsonResponse(500, { error: "boom" })));

      const pending = runCycle(prisma, config, "active_set_poll");
      await vi.runAllTimersAsync();
      await pending;

      expect(row.status).toBe("permission_denied");
      expect(row.lastSyncError).toBe("Linear API error 500");
    } finally {
      vi.useRealTimers();
    }
  });

  it("full lifecycle: connected → permission_denied (Sentry once across repeated 403s) → connected", async () => {
    const { row, prisma } = fakeDb("connected");

    stubFetch(() => jsonResponse(403, {}));
    await runCycle(prisma, config, "active_set_poll");
    expect(row.status).toBe("permission_denied");
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    // Still denied on the next two cycles — no new Sentry event for either.
    stubFetch(() => jsonResponse(403, {}));
    await runCycle(prisma, config, "active_set_poll");
    stubFetch(() => jsonResponse(403, {}));
    await runCycle(prisma, config, "reconciliation_sweep");
    expect(row.status).toBe("permission_denied");
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    // Access restored provider-side: the next clean cycle recovers on its own.
    stubFetch(() => jsonResponse(200, emptyIssuesPage));
    await runCycle(prisma, config, "active_set_poll");
    expect(row.status).toBe("connected");
    expect(row.lastSyncError).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    // And a fresh loss after recovery is a new incident, reported again.
    stubFetch(() => jsonResponse(403, {}));
    await runCycle(prisma, config, "active_set_poll");
    expect(row.status).toBe("permission_denied");
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("never overwrites a disconnect that lands mid-cycle — neither the 403 nor the recovery transition", async () => {
    const denied = fakeDb("connected");
    stubFetch(() => {
      denied.row.status = "disconnected";
      return jsonResponse(403, {});
    });
    await runCycle(denied.prisma, config, "active_set_poll");
    expect(denied.row.status).toBe("disconnected");

    const recovering = fakeDb("permission_denied");
    stubFetch(() => {
      recovering.row.status = "disconnected";
      return jsonResponse(200, emptyIssuesPage);
    });
    await runCycle(recovering.prisma, config, "active_set_poll");
    expect(recovering.row.status).toBe("disconnected");
  });

  it("still selects permission_denied integrations for sync, but not disconnected ones", async () => {
    const { prisma } = fakeDb("permission_denied");
    const fetchMock = stubFetch(() => jsonResponse(200, emptyIssuesPage));

    await runCycle(prisma, config, "active_set_poll");

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          integrations: expect.objectContaining({ where: { status: { not: "disconnected" } } }),
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("runCycle — Next Reply cycle pipeline wiring (Step 7)", () => {
  function orgOnlyDb(): PrismaClient {
    const prisma = {
      organization: { findMany: vi.fn(async () => [{ id: "org_1", integrations: [] }]) },
    };
    return prisma as unknown as PrismaClient;
  }

  beforeEach(() => {
    vi.mocked(runCommitmentPipeline).mockClear();
    vi.mocked(runNextReplyCyclePipeline).mockClear();
    vi.mocked(runEvaluationPipeline).mockClear();
  });

  it("runs between commitments and evaluation, sharing one asOf, and rolls its counts into CycleResult", async () => {
    const prisma = orgOnlyDb();
    vi.mocked(runNextReplyCyclePipeline).mockResolvedValueOnce({
      casesConsidered: 3,
      cyclesCreated: 2,
      cyclesCancelled: 1,
      cyclesRestored: 1,
      casesFailed: [],
    });

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(runCommitmentPipeline).toHaveBeenCalledWith(prisma, "org_1", {
      context: { policyVersionRows: [], customersWithCalendarOverride: [] },
    });
    expect(runNextReplyCyclePipeline).toHaveBeenCalledTimes(1);
    expect(runEvaluationPipeline).toHaveBeenCalledTimes(1);

    // create -> derive cycles -> evaluate, in that order.
    const commitmentsOrder = vi.mocked(runCommitmentPipeline).mock.invocationCallOrder[0]!;
    const cyclesOrder = vi.mocked(runNextReplyCyclePipeline).mock.invocationCallOrder[0]!;
    const evaluationOrder = vi.mocked(runEvaluationPipeline).mock.invocationCallOrder[0]!;
    expect(commitmentsOrder).toBeLessThan(cyclesOrder);
    expect(cyclesOrder).toBeLessThan(evaluationOrder);

    // One asOf, shared rather than each pipeline computing its own `new Date()`.
    const [, , cycleOptions] = vi.mocked(runNextReplyCyclePipeline).mock.calls[0]!;
    const [, , evaluationOptions] = vi.mocked(runEvaluationPipeline).mock.calls[0]!;
    expect(cycleOptions).toMatchObject({ asOf: expect.any(String) });
    expect(evaluationOptions).toMatchObject({ asOf: (cycleOptions as { asOf: string }).asOf });

    expect(result.cyclesCreated).toBe(2);
    expect(result.cyclesCancelled).toBe(1);
    expect(result.cyclesRestored).toBe(1);
  });

  it("scopes the poll's Next Reply pass to active cases, and the hourly sweep to all", async () => {
    const prisma = orgOnlyDb();

    await runCycle(prisma, config, "active_set_poll", "poll", { activePollMs: 60 * 60 * 1000 });
    const [, , pollOptions] = vi.mocked(runNextReplyCyclePipeline).mock.calls[0]!;
    expect(pollOptions).toMatchObject({ scope: "active", changedSince: expect.any(Date) });
    // Lookback is 3 poll intervals (an hour here), so a slow tick still overlaps the next.
    const { asOf, changedSince } = pollOptions as { asOf: string; changedSince: Date };
    expect(new Date(asOf).getTime() - changedSince.getTime()).toBe(3 * 60 * 60 * 1000);

    vi.mocked(runNextReplyCyclePipeline).mockClear();
    await runCycle(prisma, config, "reconciliation_sweep");
    const [, , sweepOptions] = vi.mocked(runNextReplyCyclePipeline).mock.calls[0]!;
    expect(sweepOptions).not.toHaveProperty("scope");
  });

  it("records a Next Reply cycle pipeline failure without aborting commitments or evaluation", async () => {
    const prisma = orgOnlyDb();
    vi.mocked(runNextReplyCyclePipeline).mockRejectedValueOnce(new Error("boom"));

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(result.failures).toEqual([{ organizationId: "org_1", stage: "next_reply_cycles", error: "boom" }]);
    expect(runEvaluationPipeline).toHaveBeenCalledTimes(1);
  });
});

describe("runCycle — bounded organization concurrency", () => {
  const orgIds = Array.from({ length: 8 }, (_, i) => `org_${i + 1}`);
  const multiOrgDb = () =>
    ({
      organization: { findMany: vi.fn(async () => orgIds.map((id) => ({ id, integrations: [] }))) },
    }) as unknown as PrismaClient;

  /** Makes each org's evaluation stage take a while and records how many overlap. */
  function trackEvaluationOverlap() {
    const state = { inFlight: 0, max: 0, calls: [] as string[] };
    vi.mocked(runEvaluationPipeline).mockImplementation((async (_prisma: unknown, organizationId: string) => {
      state.calls.push(organizationId);
      state.inFlight += 1;
      state.max = Math.max(state.max, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      state.inFlight -= 1;
      return {
        commitmentsConsidered: 2,
        evaluationsCreated: 1,
        commitmentsFinalized: 0,
        notificationCandidates: [],
      };
    }) as never);
    return state;
  }

  afterEach(() => {
    vi.mocked(runEvaluationPipeline).mockReset();
    vi.mocked(runEvaluationPipeline).mockResolvedValue({
      commitmentsConsidered: 0,
      evaluationsCreated: 0,
      commitmentsFinalized: 0,
      notificationCandidates: [],
    });
  });

  it("never exceeds the configured limit, processes every organization exactly once, and sums counters without loss", async () => {
    const overlap = trackEvaluationOverlap();

    const result = await runCycle(multiOrgDb(), { ...config, organizationConcurrency: 3 }, "active_set_poll");

    expect(overlap.max).toBe(3);
    expect([...overlap.calls].sort()).toEqual([...orgIds].sort());
    expect(result.organizationsProcessed).toBe(8);
    expect(result.commitmentsConsidered).toBe(16);
    expect(result.evaluationsCreated).toBe(8);
    expect(result.failures).toEqual([]);
  });

  it("concurrency 1 reproduces the sequential behaviour", async () => {
    const overlap = trackEvaluationOverlap();

    await runCycle(multiOrgDb(), { ...config, organizationConcurrency: 1 }, "active_set_poll");

    expect(overlap.max).toBe(1);
    expect(overlap.calls).toEqual(orgIds);
  });

  it("a failing organization is recorded against itself and does not stop the others", async () => {
    const overlap = trackEvaluationOverlap();
    const tracked = vi.mocked(runEvaluationPipeline).getMockImplementation()!;
    vi.mocked(runEvaluationPipeline).mockImplementation((async (prisma: unknown, organizationId: string, opts: unknown) => {
      if (organizationId === "org_2") throw new Error("eval boom");
      return tracked(prisma as never, organizationId, opts as never);
    }) as never);

    const result = await runCycle(multiOrgDb(), { ...config, organizationConcurrency: 3 }, "active_set_poll");

    expect(result.failures).toEqual([{ organizationId: "org_2", stage: "evaluation", error: "eval boom" }]);
    expect(result.organizationsProcessed).toBe(8);
    expect(result.evaluationsCreated).toBe(7);
    expect(overlap.calls).not.toContain("org_2");
    expect(overlap.calls).toHaveLength(7);
  });
});


describe("processOrganization — lease handling (multi-worker)", () => {
  function ctx(lease?: LeaseGuard): OrganizationRunContext {
    return {
      kind: "active_set_poll",
      logger: createLogger(),
      result: emptyCycleResult("active_set_poll"),
      position: "1/1",
      inFlight: () => 1,
      lease,
    };
  }
  const organization = (row: { id: string; provider: string; credentials: unknown; status: string }) => ({ id: "org_1", integrations: [row] });
  const guard = (overrides: Partial<LeaseGuard> = {}): LeaseGuard => ({
    isValid: () => true,
    assertValid: () => undefined,
    assertHeld: async () => undefined,
    ...overrides,
  });

  it("with a valid lease behaves exactly like a cycle run", async () => {
    const { row, prisma } = fakeDb("connected");
    stubFetch(() => jsonResponse(200, emptyIssuesPage));
    const context = ctx(guard());
    await processOrganization(prisma, config, organization(row), context);
    expect(context.result.failures).toEqual([]);
    expect(row.lastSyncAt).not.toBeNull();
  });

  it("a lease lost before ingestion stops the run before any provider call or write", async () => {
    const { row, prisma } = fakeDb("connected");
    const fetchMock = stubFetch(() => jsonResponse(200, emptyIssuesPage));
    const lost = guard({ assertValid: () => { throw new LeaseLostError("org_1", "taken over"); } });

    await expect(processOrganization(prisma, config, organization(row), ctx(lost))).rejects.toThrow(LeaseLostError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row.lastSyncAt).toBeNull();
  });

  it("a LeaseLostError raised by a fenced cursor write during ingestion aborts the run — it is not recorded as a sync failure", async () => {
    const { row, prisma } = fakeDb("connected");
    stubFetch(() => jsonResponse(200, emptyIssuesPage));
    // The fence rejects the cursor write the provider package makes mid-backfill.
    vi.mocked(prisma.integration.update).mockImplementationOnce(async () => {
      throw new LeaseLostError("org_1", "integration write rejected: lease no longer held");
    });
    const context = ctx(guard());

    await expect(processOrganization(prisma, config, organization(row), context)).rejects.toThrow(LeaseLostError);
    expect(context.result.failures).toEqual([]); // not an "ingest:linear" failure
    expect(row.lastSyncError).toBeNull();
    expect(captureExceptionMock).not.toHaveBeenCalled(); // and not a Sentry-worthy ingest error
  });

  it("a lease that cannot be confirmed in the database stops the run before the projection phase", async () => {
    const { row, prisma } = fakeDb("connected");
    vi.mocked(runCommitmentPipeline).mockClear();
    stubFetch(() => jsonResponse(200, emptyIssuesPage));
    const context = ctx(guard({ assertHeld: async () => { throw new LeaseLostError("org_1", "fenced out"); } }));

    await expect(processOrganization(prisma, config, organization(row), context)).rejects.toThrow(LeaseLostError);
    // Ingestion happened (it is covered by the per-write fence), but nothing after the check did.
    expect(vi.mocked(runCommitmentPipeline)).not.toHaveBeenCalled();
    expect(row.lastSyncAt).toBeNull();
  });
});
