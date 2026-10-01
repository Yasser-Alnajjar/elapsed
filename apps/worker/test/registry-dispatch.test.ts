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
  const ingestBehaviour: Record<string, () => never> = {};
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
      async normalize() {
        calls.push(`normalize:${provider}`);
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
  return { calls, ingestBehaviour, stub };
});
const { calls, ingestBehaviour } = h;

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
function fiveProviderDb() {
  const rows = (["github", "jira", "linear", "intercom", "zendesk"] as const).map((provider) => ({
    id: `int_${provider}`,
    provider,
    status: "connected",
    credentials: {},
    lastSyncAt: null as Date | null,
    lastSyncError: null as string | null,
  }));
  const prisma = {
    organization: {
      findMany: vi.fn(async () => [
        { id: "org_1", integrations: rows.map(({ id, provider, status, credentials }) => ({ id, provider, status, credentials })) },
      ]),
    },
    integration: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(rows.find((r) => r.id === where.id)!, data);
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return { rows, prisma: prisma as unknown as PrismaClient };
}

beforeEach(() => {
  calls.length = 0;
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
