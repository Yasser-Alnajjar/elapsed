import { describe, expect, it } from "vitest";
import type { Prisma } from "@sla/db";
import { planCycleCommitments } from "../src/cycle-commitments";
import {
  NextReplyRestoreBlockedError,
  StaleCancellationPreviewError,
  assessActivationImpact,
  cancelUnsupportedKindCommitments,
  previewUnsupportedKindCancellation,
} from "../src/unsupported-kinds";
import { unsupportedKindsOf } from "../src/sla-support";

type Kind = "first_response" | "next_reply" | "resolution";
type Status = "on_track" | "at_risk" | "breached" | "met" | "cancelled";
interface Row {
  id: string;
  kind: Kind;
  status: Status;
  closedAt: Date | null;
  caseId: string;
  organizationId: string;
  sourceIntegrationId: string;
}

/**
 * An in-memory stand-in for the three `commitment` calls this module makes
 * (`findMany`, `count`, `updateMany`) with the exact filters it uses. Nothing
 * is ever deleted, and every write is recorded.
 */
function fakeDb(rows: Row[]) {
  const writes: { ids: string[]; data: Record<string, unknown> }[] = [];
  const matches = (row: Row, where: Record<string, any>): boolean => {
    if (where.id?.in && !where.id.in.includes(row.id)) return false;
    if (where.kind?.in && !where.kind.in.includes(row.kind)) return false;
    if (where.case) {
      if (where.case.organizationId !== undefined && where.case.organizationId !== row.organizationId) return false;
      if (where.case.sourceIntegrationId !== undefined && where.case.sourceIntegrationId !== row.sourceIntegrationId) return false;
    }
    if ("closedAt" in where) {
      if (where.closedAt === null ? row.closedAt !== null : where.closedAt?.not === null ? row.closedAt === null : false) return false;
    }
    if (typeof where.status === "string" && row.status !== where.status) return false;
    if (where.status?.not && row.status === where.status.not) return false;
    if (where.status?.in && !where.status.in.includes(row.status)) return false;
    return true;
  };
  const db = {
    commitment: {
      findMany: async ({ where }: { where: Record<string, any> }) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
      count: async ({ where }: { where: Record<string, any> }) => rows.filter((r) => matches(r, where)).length,
      updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const hit = rows.filter((r) => matches(r, where));
        writes.push({ ids: hit.map((r) => r.id), data });
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { db, writes, rows };
}

const ORG = "org_1";
const INT = "int_1";
let seq = 0;
function row(kind: Kind, status: Status, closedAt: Date | null = null, extra: Partial<Row> = {}): Row {
  seq += 1;
  return { id: `c${String(seq).padStart(3, "0")}`, kind, status, closedAt, caseId: `case_${seq}`, organizationId: ORG, sourceIntegrationId: INT, ...extra };
}
const done = new Date("2026-10-01T00:00:00Z");
const NOW = new Date("2026-10-10T12:00:00Z");

function dataset(): Row[] {
  return [
    row("first_response", "on_track"),
    row("first_response", "at_risk"),
    row("first_response", "breached"), // breached but still open: closedAt null
    row("first_response", "met", done),
    row("first_response", "breached", done), // finalized
    row("resolution", "on_track"),
    row("resolution", "met", done),
    row("next_reply", "on_track"),
    row("next_reply", "breached"),
    row("next_reply", "cancelled", done),
    // other tenant and other integration: must never be touched
    row("first_response", "on_track", null, { organizationId: "org_2", sourceIntegrationId: "int_x" }),
    row("first_response", "on_track", null, { sourceIntegrationId: "int_other" }),
  ];
}

const FULL = null; // slaSupport of every provider that existed before N9
const RES_ONLY = { unsupportedKinds: ["first_response", "next_reply"] };
const NO_NEXT_REPLY = { unsupportedKinds: ["next_reply"] };

describe("dry-run (Q14): writes nothing and states the counts", () => {
  it("reports per kind and status, including breached with closedAt null, and that rollback does not undo it", async () => {
    const { db, writes, rows } = fakeDb(dataset());
    const before = JSON.stringify(rows);
    const preview = await previewUnsupportedKindCancellation(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"] });
    expect(preview.kinds).toEqual(["first_response"]);
    expect(preview.byKind.first_response).toEqual({ total: 3, onTrack: 1, atRisk: 1, breachedOpen: 1 });
    expect(preview.total).toBe(3);
    expect(preview.keptFinalized).toBe(2); // met + finalized breached
    expect(preview.notUndoneByRollback).toBe(true);
    expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.sampleCaseIds.length).toBeLessThanOrEqual(20);
    expect(writes).toHaveLength(0);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("is scoped to the organization and integration, and empty for no kinds", async () => {
    const { db } = fakeDb(dataset());
    const other = await previewUnsupportedKindCancellation(db, { organizationId: "org_2", integrationId: "int_x", kinds: ["first_response"] });
    expect(other.total).toBe(1);
    const none = await previewUnsupportedKindCancellation(db, { organizationId: ORG, integrationId: INT, kinds: [] });
    expect(none).toMatchObject({ total: 0, keptFinalized: 0, kinds: [] });
  });

  it("the preview hash is stable for the same set and changes when the set changes", async () => {
    const shared = dataset();
    const a = fakeDb(shared.map((r) => ({ ...r })));
    const b = fakeDb(shared.map((r) => ({ ...r })));
    const input = { organizationId: ORG, integrationId: INT, kinds: ["first_response"] as Kind[] };
    const h1 = (await previewUnsupportedKindCancellation(a.db, input)).previewHash;
    const h2 = (await previewUnsupportedKindCancellation(b.db, input)).previewHash;
    expect(h1).toBe(h2); // the hash covers the sorted ids only
    b.rows.push(row("first_response", "on_track"));
    expect((await previewUnsupportedKindCancellation(b.db, input)).previewHash).not.toBe(h1);
  });
});

describe("confirmation and cancellation (Q14)", () => {
  it("rejects a confirmation bound to a stale preview hash and writes nothing", async () => {
    const { db, writes } = fakeDb(dataset());
    await expect(cancelUnsupportedKindCommitments(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"], expectedHash: "0".repeat(64), now: NOW })).rejects.toBeInstanceOf(StaleCancellationPreviewError);
    expect(writes).toHaveLength(0);
  });

  it("a set that changed after the preview voids the confirmation", async () => {
    const { db, rows, writes } = fakeDb(dataset());
    const preview = await previewUnsupportedKindCancellation(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"] });
    rows.push(row("first_response", "on_track")); // a new commitment appears between preview and confirm
    await expect(cancelUnsupportedKindCommitments(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"], expectedHash: preview.previewHash, now: NOW })).rejects.toBeInstanceOf(StaleCancellationPreviewError);
    expect(writes).toHaveLength(0);
  });

  it("cancels only unfinalized commitments of the newly unsupported kind, matching the dry-run counts", async () => {
    const { db, rows, writes } = fakeDb(dataset());
    const finalizedBefore = JSON.stringify(rows.filter((r) => r.closedAt !== null && r.status !== "cancelled"));
    const preview = await previewUnsupportedKindCancellation(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"] });
    const result = await cancelUnsupportedKindCommitments(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"], expectedHash: preview.previewHash, now: NOW });
    expect(result.cancelled).toBe(preview.total);
    expect(result.byKind).toEqual({ first_response: 3 });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({ status: "cancelled", closedAt: NOW });

    const cancelled = rows.filter((r) => r.status === "cancelled" && r.closedAt?.getTime() === NOW.getTime());
    expect(cancelled.map((r) => r.kind)).toEqual(["first_response", "first_response", "first_response"]);
    // finalized commitments are byte-identical, other kinds are untouched, nothing deleted, other tenants untouched
    expect(JSON.stringify(rows.filter((r) => r.closedAt !== null && r.status !== "cancelled"))).toBe(finalizedBefore);
    expect(rows).toHaveLength(12);
    expect(rows.filter((r) => r.kind === "resolution").every((r) => r.status !== "cancelled")).toBe(true);
    expect(rows.filter((r) => r.kind === "next_reply" && r.status === "on_track")).toHaveLength(1);
    expect(rows.filter((r) => r.organizationId === "org_2" || r.sourceIntegrationId === "int_other").every((r) => r.status === "on_track")).toBe(true);
  });

  it("a second run is a no-op that writes nothing", async () => {
    const { db, writes } = fakeDb(dataset());
    const first = await previewUnsupportedKindCancellation(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"] });
    await cancelUnsupportedKindCommitments(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"], expectedHash: first.previewHash, now: NOW });
    const again = await previewUnsupportedKindCancellation(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"] });
    expect(again.total).toBe(0);
    const writesBefore = writes.length;
    const second = await cancelUnsupportedKindCommitments(db, { organizationId: ORG, integrationId: INT, kinds: ["first_response"], expectedHash: again.previewHash, now: NOW });
    expect(second.cancelled).toBe(0);
    expect(writes.length).toBe(writesBefore);
  });

  it("cancelling two kinds at once reports each kind", async () => {
    const { db } = fakeDb(dataset());
    const preview = await previewUnsupportedKindCancellation(db, { organizationId: ORG, integrationId: INT, kinds: ["next_reply", "first_response"] });
    expect(preview.kinds).toEqual(["first_response", "next_reply"]); // display order
    const result = await cancelUnsupportedKindCommitments(db, { organizationId: ORG, integrationId: INT, kinds: ["next_reply", "first_response"], expectedHash: preview.previewHash, now: NOW });
    expect(result.byKind).toEqual({ first_response: 3, next_reply: 2 });
  });
});

describe("assessActivationImpact: rollback after a cancellation (R5, U3 option (a))", () => {
  it("a first activation (no integration yet) has no cancellation and no block", async () => {
    const { db } = fakeDb(dataset());
    const impact = await assessActivationImpact(db, { organizationId: ORG, integrationId: null, current: FULL, target: RES_ONLY });
    expect(impact).toMatchObject({ newlyUnsupportedKinds: ["first_response", "next_reply"], cancellation: null, blocked: null, resupportedKinds: [] });
  });

  it("a version that makes kinds unsupported previews the cancellation and is not blocked", async () => {
    const { db } = fakeDb(dataset());
    const impact = await assessActivationImpact(db, { organizationId: ORG, integrationId: INT, current: FULL, target: RES_ONLY });
    expect(impact.newlyUnsupportedKinds).toEqual(["first_response", "next_reply"]);
    expect(impact.cancellation?.total).toBe(5); // 3 first_response + 2 next_reply
    expect(impact.blocked).toBeNull();
  });

  it("rolling back to a version that supports Next Reply again is REFUSED while Next Reply commitments are cancelled", async () => {
    const { db, writes } = fakeDb(dataset());
    const impact = await assessActivationImpact(db, { organizationId: ORG, integrationId: INT, current: NO_NEXT_REPLY, target: FULL });
    expect(impact.resupportedKinds).toContain("next_reply");
    expect(impact.remainsCancelled.next_reply).toBe(1);
    expect(impact.blocked).toBe("next_reply_restore_blocked");
    expect(impact.cancellation).toBeNull();
    expect(writes).toHaveLength(0);
    expect(new NextReplyRestoreBlockedError().message).toMatch(/cancelled/);
  });

  it("re-supporting first_response or resolution is allowed but reports that cancelled commitments stay cancelled", async () => {
    const rows = [row("first_response", "cancelled", done), row("first_response", "cancelled", done), row("resolution", "cancelled", done)];
    const { db } = fakeDb(rows);
    const impact = await assessActivationImpact(db, { organizationId: ORG, integrationId: INT, current: { unsupportedKinds: ["first_response", "resolution"] }, target: FULL });
    expect(impact.blocked).toBeNull();
    expect(impact.remainsCancelled).toEqual({ first_response: 2, resolution: 1 });
  });

  it("re-supporting Next Reply is allowed when nothing is cancelled", async () => {
    const { db } = fakeDb([row("next_reply", "on_track")]);
    const impact = await assessActivationImpact(db, { organizationId: ORG, integrationId: INT, current: NO_NEXT_REPLY, target: FULL });
    expect(impact.blocked).toBeNull();
    expect(impact.remainsCancelled).toEqual({});
  });

  it("an unchanged support set has no effect at all (re-activation with no change cancels nothing)", async () => {
    const { db, writes } = fakeDb(dataset());
    const impact = await assessActivationImpact(db, { organizationId: ORG, integrationId: INT, current: RES_ONLY, target: RES_ONLY });
    expect(impact).toMatchObject({ newlyUnsupportedKinds: [], resupportedKinds: [], cancellation: null, blocked: null });
    expect(writes).toHaveLength(0);
  });

  it("cancelled commitments of another tenant do not block this tenant's rollback", async () => {
    const { db } = fakeDb([row("next_reply", "cancelled", done, { organizationId: "org_2", sourceIntegrationId: "int_x" })]);
    const impact = await assessActivationImpact(db, { organizationId: ORG, integrationId: INT, current: NO_NEXT_REPLY, target: FULL });
    expect(impact.blocked).toBeNull();
  });
});

describe("cancelled commitments are never revived by the pipelines", () => {
  const cycle = (key: string) => ({ key }) as never;

  it("planCycleCommitments WOULD restore a cancelled Next Reply whose cycle is derived again, which is exactly why the rollback is refused", () => {
    const plan = planCycleCommitments([{ id: "a", cycleKey: "k1", status: "cancelled", closedAt: done }], [cycle("k1")]);
    expect(plan.restore).toEqual(["a"]);
    expect(plan.create).toEqual([]);
  });

  it("a finalized Next Reply is never cancelled or restored by the planner, even if its cycle vanishes", () => {
    const plan = planCycleCommitments([{ id: "m", cycleKey: "k1", status: "met", closedAt: done }, { id: "b", cycleKey: "k2", status: "breached", closedAt: done }], []);
    expect(plan.cancel).toEqual([]);
    expect(plan.restore).toEqual([]);
  });

  it("support sets are read from the generic slaSupport JSON: null and malformed values mean full support", () => {
    for (const value of [null, undefined, "x", 5, [], {}, { unsupportedKinds: "next_reply" }, { unsupportedKinds: [] }, { unsupportedKinds: ["bogus"] }]) {
      expect(unsupportedKindsOf(value).size).toBe(0);
    }
    expect([...unsupportedKindsOf({ unsupportedKinds: ["next_reply", "bogus", "resolution"] })].sort()).toEqual(["next_reply", "resolution"]);
  });
});
