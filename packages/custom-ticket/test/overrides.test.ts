/** "Override" row of plan 09 §13 (Q15, R1, R2, U1, U6), against an in-memory stand-in for the three tables involved. */
import type { PrismaClient } from "@sla/db";
import { describe, expect, it } from "vitest";
import {
  MAX_REASON_LENGTH,
  OVERRIDE_TTL_MS,
  OverrideError,
  applySupportOverride,
  authorizeSupportOverride,
  confirmCustomerOverride,
  latestLifecycleAbort,
} from "../src/overrides";
import { LIFECYCLE_GUARD } from "../src/normalize";
import { firstFiringGuard } from "../src/guards";

interface Run {
  id: string;
  integrationId: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: string;
  reasonCode: string | null;
  progress: unknown;
}
interface Override {
  id: string;
  organizationId: string;
  integrationId: string;
  guard: string;
  previewHash: string;
  counts: unknown;
  reason: string;
  path: "customer" | "support_assisted";
  requestedByUserId: string;
  authorizedByUserId?: string;
  confirmedAt?: Date | null;
  consumedAt: Date | null;
  outcome?: string;
  operatorEmail?: string;
  expiresAt: Date;
}

const T0 = new Date("2026-10-10T10:00:00Z");

function world(opts: { runs?: Run[]; lastSuccessfulSyncAt?: Date | null } = {}) {
  const runs = opts.runs ?? [];
  const overrides: Override[] = [];
  let seq = 0;
  const guardOverride = {
    updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      const hit = overrides.filter(
        (o) =>
          (where.id === undefined || o.id === where.id) &&
          (where.integrationId === undefined || o.integrationId === where.integrationId) &&
          (where.guard === undefined || o.guard === where.guard) &&
          (where.consumedAt === undefined || (where.consumedAt === null ? o.consumedAt === null : true)) &&
          (where.confirmedAt === undefined || (where.confirmedAt === null ? (o.confirmedAt ?? null) === null : true)),
      );
      hit.forEach((o) => Object.assign(o, data));
      return { count: hit.length };
    },
    create: async ({ data }: { data: Record<string, any> }) => {
      seq += 1;
      const row = { consumedAt: null, confirmedAt: null, ...data, id: `ov${seq}` } as Override;
      overrides.push(row);
      return { id: row.id, expiresAt: row.expiresAt };
    },
    findUnique: async ({ where }: { where: { id: string } }) => overrides.find((o) => o.id === where.id) ?? null,
  };
  const prisma = {
    integrationSyncRun: {
      findFirst: async ({ where }: { where: { integrationId: string } }) =>
        [...runs].filter((r) => r.integrationId === where.integrationId).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null,
    },
    integration: { findUnique: async () => ({ lastSuccessfulSyncAt: opts.lastSuccessfulSyncAt ?? null }) },
    guardOverride,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ guardOverride }),
  } as unknown as PrismaClient;
  return { prisma, overrides, runs };
}

const abortRun = (overrides: Partial<Run> = {}): Run => ({
  id: "run1",
  integrationId: "int1",
  startedAt: T0,
  finishedAt: new Date(T0.getTime() + 5000),
  outcome: "aborted",
  reasonCode: LIFECYCLE_GUARD,
  progress: { R: 45, L: 140, ratio: 0.32, recordIds: ["T-1", "T-2"], previewHash: "hash-1" },
  ...overrides,
});
const input = (extra: Record<string, unknown> = {}) => ({ organizationId: "org1", integrationId: "int1", userId: "owner1", previewHash: "hash-1", reason: "Quarterly cleanup closed many tickets", now: T0, ...extra });

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof OverrideError ? error.code : `other:${String(error)}`;
  }
  return "no_error";
}

describe("only the lifecycle guard can be overridden", () => {
  it("the engine's skip flag affects the lifecycle guard only; the ceiling, deletion and failure guards still fire", () => {
    const flipped = { L: 100, B: 100, F: 0, D: 0, R: 50, N: 0, C: 5000 };
    expect(firstFiringGuard(flipped, { lifecycleOverridden: true })).toBeNull();
    for (const [name, counts] of [
      ["live_case_ceiling", { ...flipped, N: 99_999 }],
      ["mass_deletion", { ...flipped, D: 60 }],
      ["mass_record_failure", { ...flipped, F: 90 }],
    ] as const) {
      expect(firstFiringGuard(counts, { lifecycleOverridden: true }), name).toBe(name);
    }
  });

  it("the override only ever targets the lifecycle guard", async () => {
    const w = world({ runs: [abortRun()] });
    await confirmCustomerOverride(w.prisma, input());
    expect(w.overrides.every((o) => o.guard === LIFECYCLE_GUARD)).toBe(true);
    expect(LIFECYCLE_GUARD).toBe("mass_lifecycle_change");
  });

  it("a mass-deletion, record-failure or ceiling abort offers nothing to override", async () => {
    for (const reasonCode of ["mass_deletion", "mass_record_failure", "live_case_ceiling"]) {
      const w = world({ runs: [abortRun({ reasonCode })] });
      expect(await latestLifecycleAbort(w.prisma, "int1")).toBeNull();
      expect(await code(confirmCustomerOverride(w.prisma, input()))).toBe("no_aborted_pass");
      expect(w.overrides).toHaveLength(0);
    }
  });
});

describe("the preview", () => {
  it("returns R, L, ratio, at most 20 record ids and the hash", async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `T-${i}`);
    const w = world({ runs: [abortRun({ progress: { R: 40, L: 100, ratio: 0.4, recordIds: ids, previewHash: "h" } })] });
    const preview = await latestLifecycleAbort(w.prisma, "int1");
    expect(preview).toMatchObject({ counts: { R: 40, L: 100, ratio: 0.4 }, previewHash: "h" });
    expect(preview!.recordIds).toHaveLength(20);
  });

  it("is absent when the latest run is not an abort, so a later run or retry never leaves a stale override", async () => {
    const aborted = abortRun();
    const later = { ...abortRun({ id: "run2", outcome: "ok", reasonCode: null, startedAt: new Date(T0.getTime() + 60_000), progress: null }) };
    expect(await latestLifecycleAbort(world({ runs: [aborted, later] }).prisma, "int1")).toBeNull();
  });

  it("a superseded abort (a later clean no-change check) is no longer overridable (D32)", async () => {
    const w = world({ runs: [abortRun()], lastSuccessfulSyncAt: new Date(T0.getTime() + 10 * 60_000) });
    expect(await latestLifecycleAbort(w.prisma, "int1")).toBeNull();
    expect(await code(confirmCustomerOverride(w.prisma, input()))).toBe("no_aborted_pass");
  });

  it("is absent when the abort row has no preview hash, and is not cleared by waiting", async () => {
    expect(await latestLifecycleAbort(world({ runs: [abortRun({ progress: { R: 1, L: 2 } })] }).prisma, "int1")).toBeNull();
    // the same abort is still there 30 days later: only a newer run or a clean check clears it
    const w = world({ runs: [abortRun()] });
    expect(await latestLifecycleAbort(w.prisma, "int1")).not.toBeNull();
    expect(await code(confirmCustomerOverride(w.prisma, input({ now: new Date(T0.getTime() + 30 * 86_400_000) })))).toBe("no_error");
  });
});

describe("customer path (U1): reason, preview, bound, single-use, expiring confirmation", () => {
  it("records a confirmed, bound, 24-hour override", async () => {
    const w = world({ runs: [abortRun()] });
    const result = await confirmCustomerOverride(w.prisma, input());
    expect(result.expiresAt.getTime() - T0.getTime()).toBe(OVERRIDE_TTL_MS);
    expect(OVERRIDE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(w.overrides[0]).toMatchObject({ path: "customer", previewHash: "hash-1", organizationId: "org1", integrationId: "int1", requestedByUserId: "owner1", consumedAt: null });
    expect(w.overrides[0]!.confirmedAt).toEqual(T0);
    expect(w.overrides[0]!.counts).toEqual({ R: 45, L: 140, ratio: 0.32 });
  });

  it("refuses a missing, blank or over-long reason, and writes nothing", async () => {
    const w = world({ runs: [abortRun()] });
    for (const reason of ["", "   ", "x".repeat(MAX_REASON_LENGTH + 1)]) expect(await code(confirmCustomerOverride(w.prisma, input({ reason })))).toBe("reason_required");
    expect(w.overrides).toHaveLength(0);
    expect(await code(confirmCustomerOverride(w.prisma, input({ reason: "x".repeat(MAX_REASON_LENGTH) })))).toBe("no_error");
  });

  it("a changed record set (a different preview hash) voids the confirmation", async () => {
    const w = world({ runs: [abortRun()] });
    expect(await code(confirmCustomerOverride(w.prisma, input({ previewHash: "hash-OLD" })))).toBe("stale_preview");
    expect(w.overrides).toHaveLength(0);
  });

  it("a new request voids any earlier unused override for the same integration and guard", async () => {
    const w = world({ runs: [abortRun()] });
    await confirmCustomerOverride(w.prisma, input());
    await confirmCustomerOverride(w.prisma, input({ now: new Date(T0.getTime() + 1000) }));
    expect(w.overrides).toHaveLength(2);
    expect(w.overrides[0]).toMatchObject({ outcome: "void" });
    expect(w.overrides[0]!.consumedAt).not.toBeNull();
    expect(w.overrides[1]!.consumedAt).toBeNull();
  });

  it("no abort at all means nothing to confirm", async () => {
    expect(await code(confirmCustomerOverride(world().prisma, input()))).toBe("no_aborted_pass");
  });
});

describe("support-assisted path (U6): owner authorization first, then a distinct operator", () => {
  it("authorizing records the owner's authorization but overrides nothing yet", async () => {
    const w = world({ runs: [abortRun()] });
    await authorizeSupportOverride(w.prisma, input());
    expect(w.overrides[0]).toMatchObject({ path: "support_assisted", authorizedByUserId: "owner1" });
    expect(w.overrides[0]!.confirmedAt ?? null).toBeNull(); // not effective until an operator applies it
  });

  it("the operator applies exactly that authorization, once", async () => {
    const w = world({ runs: [abortRun()] });
    const { id } = await authorizeSupportOverride(w.prisma, input());
    const applied = await applySupportOverride({ guardOverride: (w.prisma as any).guardOverride } as any, { overrideId: id, operatorEmail: "ops@elapsed.test", now: new Date(T0.getTime() + 60_000) });
    expect(applied).toEqual({ organizationId: "org1", integrationId: "int1", previewHash: "hash-1" });
    expect(w.overrides[0]).toMatchObject({ operatorEmail: "ops@elapsed.test" });
    expect(w.overrides[0]!.confirmedAt).toEqual(new Date(T0.getTime() + 60_000));
    expect(await code(applySupportOverride({ guardOverride: (w.prisma as any).guardOverride } as any, { overrideId: id, operatorEmail: "ops@elapsed.test", now: new Date(T0.getTime() + 61_000) }))).toBe("already_used");
  });

  it("refuses an unknown id, a customer-path override, an unauthorized row, an expired one and a consumed one", async () => {
    const w = world({ runs: [abortRun()] });
    const tx = { guardOverride: (w.prisma as any).guardOverride } as any;
    expect(await code(applySupportOverride(tx, { overrideId: "nope", operatorEmail: "o@x", now: T0 }))).toBe("not_found");

    const customer = await confirmCustomerOverride(w.prisma, input());
    expect(await code(applySupportOverride(tx, { overrideId: customer.id, operatorEmail: "o@x", now: T0 }))).toBe("not_found"); // the operator cannot turn a customer override into a support one

    const w2 = world({ runs: [abortRun()] });
    const tx2 = { guardOverride: (w2.prisma as any).guardOverride } as any;
    const { id } = await authorizeSupportOverride(w2.prisma, input());
    w2.overrides[0]!.authorizedByUserId = undefined; // an operator-created row: no owner authorization
    expect(await code(applySupportOverride(tx2, { overrideId: id, operatorEmail: "o@x", now: T0 }))).toBe("not_authorized_by_owner");
    w2.overrides[0]!.authorizedByUserId = "owner1";
    expect(await code(applySupportOverride(tx2, { overrideId: id, operatorEmail: "o@x", now: new Date(T0.getTime() + OVERRIDE_TTL_MS) }))).toBe("expired");
    w2.overrides[0]!.consumedAt = T0;
    expect(await code(applySupportOverride(tx2, { overrideId: id, operatorEmail: "o@x", now: T0 }))).toBe("already_used");
  });

  it("authorizing against a stale preview or without a reason is refused like the customer path", async () => {
    const w = world({ runs: [abortRun()] });
    expect(await code(authorizeSupportOverride(w.prisma, input({ previewHash: "other" })))).toBe("stale_preview");
    expect(await code(authorizeSupportOverride(w.prisma, input({ reason: " " })))).toBe("reason_required");
    expect(w.overrides).toHaveLength(0);
  });
});
