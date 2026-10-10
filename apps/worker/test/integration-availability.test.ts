/**
 * N10 (D33) in the worker: an integration whose provider is unavailable to its
 * organization is skipped exactly like an operator pause. No provider call, no
 * sync attempt or failure recorded, no "failing since" streak, and its status
 * is never changed, while normalization and evaluation of stored data still
 * run. Availability is read fresh on every organization run, so re-enabling
 * resumes ingest on the next run; an unreadable policy fails closed.
 *
 * The registry is replaced by stub adapters that record their calls; no
 * database, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sla/db";
import { runEvaluationPipeline } from "@sla/commitments";
import { runCycle } from "../src/cycle";
import type { WorkerConfig } from "../src/config";

vi.mock("../src/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@sla/commitments", () => ({
  buildCaseRefResolver: vi.fn().mockResolvedValue(null),
  ensureDefaultCalendarVersion: vi.fn().mockResolvedValue({ id: "cal" }),
  loadPolicyContext: vi.fn().mockResolvedValue({ policyVersionRows: [], customersWithCalendarOverride: [], currentCalendarVersionById: new Map() }),
  runCommitmentPipeline: vi.fn().mockResolvedValue({ commitmentsCreated: 0, casesWithNoMatchingPolicy: 0 }),
  runCommitmentReResolutionPipeline: vi.fn().mockResolvedValue({ commitmentsUpdated: 0 }),
  runNextReplyCyclePipeline: vi.fn().mockResolvedValue({ cyclesCreated: 0, cyclesCancelled: 0, cyclesRestored: 0 }),
  runEvaluationPipeline: vi.fn().mockResolvedValue({ commitmentsConsidered: 0, evaluationsCreated: 0, commitmentsFinalized: 0, notificationCandidates: [] }),
}));
vi.mock("@sla/notifications", () => ({
  claimNotifications: vi.fn().mockResolvedValue(null),
  deliverClaimedNotifications: vi.fn(),
}));

const h = vi.hoisted(() => {
  const calls: string[] = [];
  /** What the resolver answers per provider for this run; absent = available. */
  const unavailable: Record<string, string> = {};
  const availability = { fail: false };
  const emptyBatch = () => ({ customers: [], cases: [], eventGroups: [], deletedCaseExternalIds: [], failures: [] });
  function stub(provider: string, role: string) {
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
        return { recordsFetched: 0, counts: {} };
      },
      async normalize() {
        calls.push(`normalize:${provider}`);
        return emptyBatch();
      },
    };
  }
  return { calls, unavailable, availability, stub };
});

vi.mock("@sla/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sla/db")>()),
  withOrganizationSlaLock: vi.fn((_p: unknown, _o: string, work: () => Promise<unknown>) => work()),
  recordSlaImportSummary: vi.fn(),
  getIntegrationConfig: vi.fn().mockResolvedValue({ clientId: "id", clientSecret: "secret" }),
  resolveOrganizationAvailability: vi.fn(async () => {
    if (h.availability.fail) throw new Error("connection refused");
    return Object.fromEntries(
      ["zendesk", "jira", "linear", "intercom", "github", "custom"].map((provider) => [
        provider,
        h.unavailable[provider]
          ? { available: false, provider, releaseStage: "stable", code: h.unavailable[provider], message: "x", statusMessage: null }
          : { available: true, provider, releaseStage: "stable" },
      ]),
    );
  }),
}));

vi.mock("../src/providers", () => ({
  PROVIDERS: { zendesk: h.stub("zendesk", "ticket_source"), jira: h.stub("jira", "work_tracker"), custom: h.stub("custom", "ticket_source") },
}));

const config = { appUrl: "https://app.example.com" } as WorkerConfig;

function fakeDb() {
  const rows = (["zendesk", "jira", "custom"] as const).map((provider) => ({
    id: `int_${provider}`,
    provider,
    status: "connected",
    credentials: { token: "enc:v1:opaque" },
    lastSyncAt: null as Date | null,
    lastSyncError: null as string | null,
    consecutiveFailures: 0,
    failingSince: null as Date | null,
    pollingPausedAt: null,
    renormalizeRequestedAt: null,
  }));
  const writes: { id: string; data: Record<string, unknown> }[] = [];
  const prisma = {
    organization: {
      findMany: vi.fn(async () => [
        { id: "org_1", integrations: rows.map(({ id, provider, status, credentials, failingSince, pollingPausedAt, renormalizeRequestedAt }) => ({ id, provider, status, credentials, failingSince, pollingPausedAt, renormalizeRequestedAt })) },
      ]),
    },
    integration: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        writes.push({ id: where.id, data });
        Object.assign(rows.find((r) => r.id === where.id)!, data);
        return {};
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        writes.push({ id: where.id, data });
        return { count: 1 };
      }),
    },
    integrationSyncRun: { create: vi.fn(async () => ({})) },
  };
  return { rows, writes, prisma: prisma as unknown as PrismaClient };
}

beforeEach(() => {
  h.calls.length = 0;
  for (const key of Object.keys(h.unavailable)) delete h.unavailable[key];
  h.availability.fail = false;
  vi.mocked(runEvaluationPipeline).mockClear();
});

describe("worker enforcement of platform availability (N10, D33)", () => {
  it("skips ingest for a disabled provider like a pause: no call, no failure, no sync write, status untouched", async () => {
    h.unavailable.zendesk = "integration_disabled";
    const { prisma, rows, writes } = fakeDb();

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(h.calls).not.toContain("ingest:zendesk");
    expect(h.calls).toEqual(expect.arrayContaining(["ingest:jira", "ingest:custom"]));
    expect(result.failures).toEqual([]);
    expect(writes.filter((w) => w.id === "int_zendesk")).toEqual([]);
    expect(rows.find((r) => r.id === "int_zendesk")).toMatchObject({ status: "connected", consecutiveFailures: 0, failingSince: null, credentials: { token: "enc:v1:opaque" } });
  });

  it("still normalizes and evaluates the stored data of an unavailable provider", async () => {
    h.unavailable.zendesk = "integration_disabled";
    const { prisma } = fakeDb();

    await runCycle(prisma, config, "active_set_poll");

    expect(h.calls).toContain("normalize:zendesk");
    expect(runEvaluationPipeline).toHaveBeenCalledTimes(1);
  });

  it("treats Coming Soon and a Beta the organization is not allowed into the same way", async () => {
    h.unavailable.jira = "integration_coming_soon";
    h.unavailable.custom = "integration_beta_restricted";
    const { prisma } = fakeDb();

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(h.calls.filter((c) => c.startsWith("ingest:"))).toEqual(["ingest:zendesk"]);
    expect(result.failures).toEqual([]);
  });

  it("re-reads availability on every run: re-enabling resumes ingest on the next run with no restart", async () => {
    h.unavailable.zendesk = "integration_disabled";
    const { prisma } = fakeDb();
    await runCycle(prisma, config, "active_set_poll");
    expect(h.calls).not.toContain("ingest:zendesk");

    delete h.unavailable.zendesk;
    h.calls.length = 0;
    await runCycle(prisma, config, "active_set_poll");
    expect(h.calls).toContain("ingest:zendesk");
  });

  it("fails closed when availability cannot be read: no provider is called, stored data is still evaluated, and the failure is recorded", async () => {
    h.availability.fail = true;
    const { prisma } = fakeDb();

    const result = await runCycle(prisma, config, "active_set_poll");

    expect(h.calls.filter((c) => c.startsWith("ingest:"))).toEqual([]);
    expect(h.calls).toEqual(expect.arrayContaining(["normalize:zendesk", "normalize:jira", "normalize:custom"]));
    expect(runEvaluationPipeline).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([{ organizationId: "org_1", stage: "availability", error: "connection refused" }]);
  });
});
