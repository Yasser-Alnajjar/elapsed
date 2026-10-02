/**
 * N2.4 — the cycle dispatches through the provider registry: integrations are
 * ordered by role (ticket sources, then trackers, then code hosts), the three
 * shared error types drive the integration's status, and one provider's
 * failure never stops the others or the evaluation that follows.
 *
 * The registry is replaced by five stub adapters that record their calls; no
 * database, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sla/db";
import { runEvaluationPipeline } from "@sla/commitments";
import { PermissionDeniedError, ProviderUnavailableError, ReauthRequiredError } from "@sla/ingestion";
import { runCycle } from "../src/cycle";
import type { WorkerConfig } from "../src/config";

vi.mock("../src/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@sla/commitments", () => ({
  buildCaseRefResolver: vi.fn().mockResolvedValue(null),
  ensureDefaultCalendarVersion: vi.fn().mockResolvedValue({ id: "cal" }),
  loadPolicyContext: vi.fn().mockResolvedValue({ policyVersionRows: [], customersWithCalendarOverride: [] }),
  runCommitmentPipeline: vi.fn().mockResolvedValue({ commitmentsCreated: 0, casesWithNoMatchingPolicy: 0 }),
  runCommitmentReResolutionPipeline: vi.fn().mockResolvedValue({ commitmentsUpdated: 0 }),
  runNextReplyCyclePipeline: vi.fn().mockResolvedValue({ cyclesCreated: 0, cyclesCancelled: 0, cyclesRestored: 0 }),
  runEvaluationPipeline: vi
    .fn()
    .mockResolvedValue({ commitmentsConsidered: 0, evaluationsCreated: 0, commitmentsFinalized: 0, notificationCandidates: [] }),
}));
vi.mock("@sla/notifications", () => ({
  claimNotifications: vi.fn().mockResolvedValue(null),
  deliverClaimedNotifications: vi.fn(),
}));
vi.mock("@sla/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sla/db")>()),
  withOrganizationSlaLock: vi.fn((_p: unknown, _o: string, work: () => Promise<unknown>) => work()),
  recordSlaImportSummary: vi.fn(),
  getIntegrationConfig: vi.fn().mockResolvedValue({ clientId: "id", clientSecret: "secret" }),
}));

const h = vi.hoisted(() => {
  const calls: string[] = [];
  /** The `mode` each provider's normalize was called with, in call order. */
  const normalizeModes: Record<string, string[]> = {};
  const ingestBehaviour: Record<string, () => never> = {};
  const normalizeBehaviour: Record<string, () => never> = {};
  const emptyBatch = () => ({ customers: [], cases: [], eventGroups: [], deletedCaseExternalIds: [], failures: [] });

  function stub(provider: string, role: string, withCorrelate: boolean) {
    return {
      provider,
      role,
      capabilities: {
        webhooks: false,
        policyImport: false,
        calendarImport: false,
        incrementalNormalization: false,
        replyEvents: false,
        priorityChanges: false,
        officialLinks: false,
      },
      async ingest() {
        calls.push(`ingest:${provider}`);
        ingestBehaviour[provider]?.();
        return { recordsFetched: 0, counts: {} };
      },
      async normalize(ctx: { mode: string }) {
        calls.push(`normalize:${provider}`);
        (normalizeModes[provider] ??= []).push(ctx.mode);
        normalizeBehaviour[provider]?.();
        return emptyBatch();
      },
      ...(withCorrelate
        ? {
            async correlate() {
              calls.push(`correlate:${provider}`);
              return { links: [], sweeps: [], evaluated: 0, unmatched: {} };
            },
          }
        : {}),
    };
  }
  return { calls, normalizeModes, ingestBehaviour, normalizeBehaviour, stub };
});
const { calls, normalizeModes, ingestBehaviour, normalizeBehaviour } = h;

vi.mock("../src/providers", () => ({
  PROVIDERS: {
    zendesk: h.stub("zendesk", "ticket_source", true),
    jira: h.stub("jira", "work_tracker", true),
    intercom: h.stub("intercom", "ticket_source", false),
    linear: h.stub("linear", "work_tracker", true),
    github: h.stub("github", "code_host", true),
  },
}));

const config = { appUrl: "https://app.example.com" } as WorkerConfig;

/** Five integrations, listed in the worst order for the cycle: code host first, tracker before ticket source. */
function fiveProviderDb(operator: Partial<Record<"github" | "jira" | "linear" | "intercom" | "zendesk", { pollingPausedAt?: Date; renormalizeRequestedAt?: Date }>> = {}) {
  const rows = (["github", "jira", "linear", "intercom", "zendesk"] as const).map((provider) => ({
    id: `int_${provider}`,
    provider,
    status: "connected",
    credentials: {},
    lastSyncAt: null as Date | null,
    lastSyncError: null as string | null,
    consecutiveFailures: 0,
    pollingPausedAt: operator[provider]?.pollingPausedAt ?? null,
    renormalizeRequestedAt: operator[provider]?.renormalizeRequestedAt ?? null,
  }));
  const prisma = {
    organization: {
      findMany: vi.fn(async () => [
        {
          id: "org_1",
          integrations: rows.map(({ id, provider, status, credentials, pollingPausedAt, renormalizeRequestedAt }) => ({
            id,
            provider,
            status,
            credentials,
            pollingPausedAt,
            renormalizeRequestedAt,
          })),
        },
      ]),
    },
    integration: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(rows.find((r) => r.id === where.id)!, data);
        return {};
      }),
      // Compare-and-set clear of the re-normalize request, the only
      // `updateMany` the cycle makes besides the permission transitions.
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; renormalizeRequestedAt?: Date }; data: Record<string, unknown> }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) return { count: 0 };
          if (where.renormalizeRequestedAt && row.renormalizeRequestedAt?.getTime() !== where.renormalizeRequestedAt.getTime()) {
            return { count: 0 };
          }
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
  };
  return { rows, prisma: prisma as unknown as PrismaClient };
}

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(normalizeModes)) delete normalizeModes[key];
  for (const key of Object.keys(normalizeBehaviour)) delete normalizeBehaviour[key];
  for (const key of Object.keys(ingestBehaviour)) delete ingestBehaviour[key];
  vi.mocked(runEvaluationPipeline).mockClear();
});

describe("runCycle — registry dispatch (N2.4)", () => {
  it("processes ticket sources, then work trackers, then code hosts", async () => {
    const { prisma } = fiveProviderDb();

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(result.failures).toEqual([]);
    const order = (prefix: string) => calls.filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length));
    const roleRank = (p: string) => ({ zendesk: 0, intercom: 0, jira: 1, linear: 1, github: 2 })[p as "zendesk"];
    for (const stage of ["ingest:", "normalize:"]) {
      const ranks = order(stage).map(roleRank);
      expect(ranks, stage).toEqual([...ranks].sort((a, b) => a - b));
      expect(order(stage)).toHaveLength(5);
    }
    // A tracker correlates before it normalizes; a ticket source has the cases first.
    expect(calls.indexOf("correlate:jira")).toBeLessThan(calls.indexOf("normalize:jira"));
    expect(calls.indexOf("normalize:zendesk")).toBeLessThan(calls.indexOf("correlate:zendesk"));
    // Ingest is outside the organization lock, normalize inside it: all ingests come first.
    expect(Math.max(...calls.filter((c) => c.startsWith("ingest:")).map((c) => calls.indexOf(c)))).toBeLessThan(
      calls.indexOf("normalize:zendesk"),
    );
  });

  it("isolates a provider outage: the others still ingest, and evaluation still runs", async () => {
    const { prisma, rows } = fiveProviderDb();
    ingestBehaviour.jira = () => {
      throw new ProviderUnavailableError("Jira is down");
    };

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(result.failures).toEqual([{ organizationId: "org_1", stage: "ingest:jira", error: "Jira is down" }]);
    expect(calls.filter((c) => c.startsWith("ingest:")).sort()).toEqual(
      ["ingest:github", "ingest:intercom", "ingest:jira", "ingest:linear", "ingest:zendesk"],
    );
    // Normalization is DB-local, so even the failing provider's stored events are still derived.
    expect(calls.filter((c) => c.startsWith("normalize:"))).toHaveLength(5);
    expect(runEvaluationPipeline).toHaveBeenCalledTimes(1);
    expect(rows.find((r) => r.provider === "jira")!.lastSyncError).toBe("Jira is down");
    expect(rows.find((r) => r.provider === "linear")!.lastSyncError).toBeNull();
  });

  it("reads reauth and permission loss from the shared error types, whatever the provider", async () => {
    const { prisma, rows } = fiveProviderDb();
    ingestBehaviour.zendesk = () => {
      throw new ReauthRequiredError();
    };
    ingestBehaviour.github = () => {
      throw new PermissionDeniedError();
    };

    const result = await runCycle(prisma, config, "active_set_poll");

    // Customer-side integration health, not a failure of the worker.
    expect(result.failures).toEqual([]);
    expect(result.integrationIssues.map((i) => [i.provider, i.issue]).sort()).toEqual([
      ["github", "permission_denied"],
      ["zendesk", "reauth_required"],
    ]);
    expect(rows.find((r) => r.provider === "zendesk")!.lastSyncError).toBe("Zendesk needs to be reconnected");
    expect(rows.find((r) => r.provider === "github")!.lastSyncError).toContain("Github denied access");
  });
});

describe("runCycle — operator controls (N4.5)", () => {
  const pausedAt = new Date("2026-10-02T09:00:00Z");

  it("a paused integration is not ingested, while normalization and evaluation still run for it", async () => {
    const { prisma, rows } = fiveProviderDb({ jira: { pollingPausedAt: pausedAt } });

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(result.failures).toEqual([]);
    expect(calls).not.toContain("ingest:jira");
    expect(calls.filter((c) => c.startsWith("ingest:")).sort()).toEqual(
      ["ingest:github", "ingest:intercom", "ingest:linear", "ingest:zendesk"],
    );
    expect(calls).toContain("normalize:jira");
    expect(calls).toContain("correlate:jira");
    expect(runEvaluationPipeline).toHaveBeenCalledTimes(1);
    // Not a sync attempt, so sync health is untouched: nothing here may make it look fresh.
    const jira = rows.find((r) => r.provider === "jira")!;
    expect(jira).toMatchObject({ lastSyncAt: null, lastSyncError: null, consecutiveFailures: 0 });
    expect(jira).not.toHaveProperty("lastSuccessfulSyncAt");
    expect(rows.find((r) => r.provider === "linear")).toHaveProperty("lastSuccessfulSyncAt");
  });

  it("resuming (pollingPausedAt back to null) ingests it again", async () => {
    const { prisma } = fiveProviderDb();

    await runCycle(prisma, config, "active_set_poll");

    expect(calls).toContain("ingest:jira");
  });

  it("a re-normalization request forces a full pass on an active poll, then clears the request", async () => {
    const requestedAt = new Date("2026-10-02T09:30:00Z");
    const { prisma, rows } = fiveProviderDb({ zendesk: { renormalizeRequestedAt: requestedAt } });

    await runCycle(prisma, config, "active_set_poll");

    expect(normalizeModes.zendesk).toEqual(["full"]);
    expect(normalizeModes.jira).toEqual(["incremental"]);
    expect(rows.find((r) => r.provider === "zendesk")!.renormalizeRequestedAt).toBeNull();

    // The next poll is back to incremental: the request was one-shot.
    await runCycle(prisma, config, "active_set_poll");
    expect(normalizeModes.zendesk).toEqual(["full", "incremental"]);
  });

  it("a failed full pass keeps the request so the next run retries it", async () => {
    const requestedAt = new Date("2026-10-02T09:30:00Z");
    const { prisma, rows } = fiveProviderDb({ zendesk: { renormalizeRequestedAt: requestedAt } });
    normalizeBehaviour.zendesk = () => {
      throw new Error("boom");
    };

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(result.failures).toEqual([{ organizationId: "org_1", stage: "normalize:zendesk", error: "boom" }]);
    expect(rows.find((r) => r.provider === "zendesk")!.renormalizeRequestedAt).toEqual(requestedAt);
  });

  it("works while paused: the pass runs on stored events and the request is cleared", async () => {
    const { prisma, rows } = fiveProviderDb({
      jira: { pollingPausedAt: pausedAt, renormalizeRequestedAt: new Date("2026-10-02T09:30:00Z") },
    });

    await runCycle(prisma, config, "active_set_poll");

    expect(calls).not.toContain("ingest:jira");
    expect(normalizeModes.jira).toEqual(["full"]);
    expect(rows.find((r) => r.provider === "jira")!.renormalizeRequestedAt).toBeNull();
  });
});
