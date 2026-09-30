import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sla/db";
import { runCommitmentPipeline, runEvaluationPipeline, runNextReplyCyclePipeline } from "@sla/commitments";
import { runCycle } from "../src/cycle";
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
    expect(result.failures).toEqual([
      { organizationId: "org_1", stage: "ingest:linear", error: row.lastSyncError },
    ]);
  });

  it("HTTP 401 → existing reauth behavior: reauth_required, credentials flagged, no Sentry event", async () => {
    const { row, prisma } = fakeDb("connected");
    const fetchMock = stubFetch(() => jsonResponse(401, { errors: [{ message: "Authentication required" }] }));

    await runCycle(prisma, config, "active_set_poll");

    expect(row.status).toBe("reauth_required");
    expect(row.lastSyncError).toBe("Linear needs to be reconnected");
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
