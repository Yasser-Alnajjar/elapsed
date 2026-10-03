/**
 * `WorkerSettingsActions` read split: the full Monitoring diagnostics are
 * platform-operator-only (`notFound()` before any query), while the
 * app-wide layout reads only the active poll interval, for any user.
 */
import { readFileSync } from "node:fs";
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({ getWorkerSettingsForRead: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/request-context", () => ({ getRequestContext: vi.fn(async () => ({ session: ctx.session })) }));
vi.mock("@sla/db", () => ({
  getPrismaClient: vi.fn(() => ({})),
  getWorkerSettingsForRead: db.getWorkerSettingsForRead,
  deriveWorkerStatus: vi.fn(() => "running"),
  getWorkStateNextRuns: vi.fn(async () => ({ nextActivePollAt: null, nextReconciliationAt: null })),
}));

function sessionFor(email: string): Session {
  return { user: { email, role: "owner" } } as unknown as Session;
}

describe("WorkerSettingsActions", () => {
  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@watchtower.test";
    db.getWorkerSettingsForRead.mockReset();
    db.getWorkerSettingsForRead.mockResolvedValue({
      activePollIntervalMs: 300_000,
      reconciliationIntervalMs: 1_800_000,
      lastActivePollAt: null,
      nextActivePollAt: null,
      lastReconciliationAt: null,
      nextReconciliationAt: null,
    });
  });

  it("getMonitoringData: non-operator gets notFound before anything is queried", async () => {
    ctx.session = sessionFor("owner@tenant.test");
    const { WorkerSettingsActions } = await import("../src/actions/worker-settings");

    await expect(WorkerSettingsActions.getMonitoringData()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(db.getWorkerSettingsForRead).not.toHaveBeenCalled();
  });

  it("getMonitoringData: operator gets the full diagnostics", async () => {
    ctx.session = sessionFor("ops@watchtower.test");
    const { WorkerSettingsActions } = await import("../src/actions/worker-settings");

    await expect(WorkerSettingsActions.getMonitoringData()).resolves.toMatchObject({
      status: "running",
      reconciliationIntervalMs: 1_800_000,
      canEdit: true,
    });
  });

  it("getActivePollIntervalMs: any user gets only the interval number", async () => {
    ctx.session = sessionFor("owner@tenant.test");
    const { WorkerSettingsActions } = await import("../src/actions/worker-settings");

    await expect(WorkerSettingsActions.getActivePollIntervalMs()).resolves.toBe(300_000);
  });

  it("the tenant dashboard uses the light read, never the operator-only action", () => {
    const dashboard = readFileSync(new URL("../src/modules/dashboard/dashboard/ssr/Dashboard.tsx", import.meta.url), "utf8");
    expect(dashboard).toContain("WorkerSettings.getActivePollIntervalMs()");
    expect(dashboard).not.toContain("getMonitoringData");
  });

  it("the main layout does not read worker settings", () => {
    const layout = readFileSync(new URL("../src/app/(main)/layout.tsx", import.meta.url), "utf8");
    expect(layout).not.toContain("WorkerSettings");
  });
});
