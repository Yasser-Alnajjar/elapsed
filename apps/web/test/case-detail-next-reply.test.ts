/**
 * Step 10: a case can now have several simultaneous `next_reply` commitments
 * (one per reply cycle). `getCaseDetailData` must carry every one of them
 * through intact — with `cycleKey`, in a deterministic order (first_response,
 * then next_reply cycles by their own `startedAt`, then resolution) — and
 * the UI must be able to tell simultaneous Next Reply cards apart via a
 * presentation-only "Cycle N" label, without inventing any new stored field.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@sla/db";
import { describe, expect, it } from "vitest";
import { CommitmentCard } from "@modules/cases/case-detail/csr/CommitmentCard";
import { getCaseDetailData } from "@/lib/case-detail-data";
import { nextReplyCycleNumbers } from "@/lib/format";

const OPENED = new Date("2026-09-17T09:00:00.000Z");
const AS_OF = new Date("2026-09-17T15:00:00.000Z");

const calendarRow = {
  id: "cal-24-7",
  version: 1,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};
const policyRow = {
  id: "pv-1",
  policyId: "policy",
  policy: { name: "Standard SLA" },
  version: 1,
  match: {},
  targets: [
    { kind: "first_response", minutes: 120 },
    { kind: "resolution", minutes: 480 },
    { kind: "next_reply", minutes: 60 },
  ],
  pauseOnStates: ["pending_customer"],
  calendarVersionId: "cal-24-7",
  warnAtPercent: [50, 80, 95],
  effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
};

type Kind = "first_response" | "resolution" | "next_reply";

function commitment(overrides: {
  id: string;
  kind: Kind;
  cycleKey: string;
  startedAt?: Date;
  targetMinutes?: number;
  status?: string;
  closedAt?: Date | null;
}) {
  const startedAt = overrides.startedAt ?? OPENED;
  const targetMinutes = overrides.targetMinutes ?? 60;
  return {
    id: overrides.id,
    caseId: "case-1",
    kind: overrides.kind,
    cycleKey: overrides.cycleKey,
    policyVersionId: policyRow.id,
    calendarVersionId: calendarRow.id,
    startedAt,
    targetMinutes,
    dueAt: new Date(startedAt.getTime() + targetMinutes * 60_000),
    status: overrides.status ?? "on_track",
    closedAt: overrides.closedAt ?? null,
    createdAt: startedAt,
  };
}

function event(overrides: {
  id: string;
  type: string;
  occurredAt: Date;
  actor?: string;
  sourceSequence?: number;
}) {
  return {
    id: overrides.id,
    caseId: "case-1",
    type: overrides.type,
    occurredAt: overrides.occurredAt,
    actor: overrides.actor ?? "agent",
    system: "zendesk",
    sourceRole: "ticket_source",
    fromState: null,
    toState: null,
    sourceRawEventId: overrides.id,
    sourceSequence: overrides.sourceSequence ?? 0,
  };
}

function fakePrisma(
  commitments: ReturnType<typeof commitment>[],
  events: ReturnType<typeof event>[] = [],
): PrismaClient {
  return {
    case: {
      findFirst: async () => ({
        id: "case-1",
        organizationId: "org-1",
        externalId: "1",
        system: "zendesk",
        subject: "ticket#1",
        priority: "urgent",
        tier: null,
        channel: "web",
        openedAt: OPENED,
        closedAt: null,
        customer: null,
        caseLinks: [],
        commitments,
      }),
    },
    normalizedEvent: { findMany: async () => events },
    rawEvent: { findMany: async () => [], findFirst: async () => null },
    integration: { findMany: async () => [] },
    organization: {
      findUnique: async () => ({ engineeringLegTargetMinutes: null }),
    },
    sLAPolicyVersion: { findMany: async () => [policyRow] },
    businessCalendarVersion: { findMany: async () => [calendarRow] },
    commitmentPolicyChange: { findMany: async () => [] },
    notification: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

describe("getCaseDetailData: Next Reply multi-cycle support", () => {
  it("passes cycleKey through for every commitment, not just next_reply", async () => {
    const firstResponse = commitment({
      id: "c-fr",
      kind: "first_response",
      cycleKey: "single",
    });
    const cycle1 = commitment({
      id: "c-nr-1",
      kind: "next_reply",
      cycleKey:
        "next_reply:zendesk:raw-1:customer_replied:2026-09-17T10:00:00.000Z",
      startedAt: new Date("2026-09-17T10:00:00.000Z"),
    });
    const data = await getCaseDetailData(
      fakePrisma([firstResponse, cycle1]),
      "org-1",
      "case-1",
      AS_OF,
    );
    expect(data!.commitments.find((c) => c.id === "c-fr")!.cycleKey).toBe(
      "single",
    );
    expect(data!.commitments.find((c) => c.id === "c-nr-1")!.cycleKey).toBe(
      cycle1.cycleKey,
    );
  });

  it("keeps every next_reply commitment when a case has several simultaneously", async () => {
    const cycles = [
      commitment({
        id: "c-nr-1",
        kind: "next_reply",
        cycleKey: "cycle-1",
        startedAt: new Date("2026-09-17T10:00:00.000Z"),
      }),
      commitment({
        id: "c-nr-2",
        kind: "next_reply",
        cycleKey: "cycle-2",
        startedAt: new Date("2026-09-17T12:00:00.000Z"),
      }),
      commitment({
        id: "c-nr-3",
        kind: "next_reply",
        cycleKey: "cycle-3",
        startedAt: new Date("2026-09-17T14:00:00.000Z"),
      }),
    ];
    const data = await getCaseDetailData(
      fakePrisma(cycles),
      "org-1",
      "case-1",
      AS_OF,
    );
    expect(data!.commitments.map((c) => c.id)).toEqual([
      "c-nr-1",
      "c-nr-2",
      "c-nr-3",
    ]);
  });

  it("orders commitments deterministically — first_response, next_reply by startedAt, then resolution — never by DB fetch order", async () => {
    const resolution = commitment({
      id: "c-res",
      kind: "resolution",
      cycleKey: "single",
      targetMinutes: 480,
    });
    const firstResponse = commitment({
      id: "c-fr",
      kind: "first_response",
      cycleKey: "single",
      targetMinutes: 120,
    });
    const cycle2 = commitment({
      id: "c-nr-2",
      kind: "next_reply",
      cycleKey: "cycle-2",
      startedAt: new Date("2026-09-17T12:00:00.000Z"),
    });
    const cycle1 = commitment({
      id: "c-nr-1",
      kind: "next_reply",
      cycleKey: "cycle-1",
      startedAt: new Date("2026-09-17T10:00:00.000Z"),
    });
    // Deliberately fed out of the desired display order, as an unordered DB
    // fetch might return them.
    const data = await getCaseDetailData(
      fakePrisma([resolution, cycle2, firstResponse, cycle1]),
      "org-1",
      "case-1",
      AS_OF,
    );
    expect(data!.commitments.map((c) => c.id)).toEqual([
      "c-fr",
      "c-nr-1",
      "c-nr-2",
      "c-res",
    ]);
  });

  it("gives each simultaneous next_reply commitment a deterministic Cycle N presentation label, in startedAt order", async () => {
    const cycle2 = commitment({
      id: "c-nr-2",
      kind: "next_reply",
      cycleKey: "cycle-2",
      startedAt: new Date("2026-09-17T12:00:00.000Z"),
    });
    const cycle1 = commitment({
      id: "c-nr-1",
      kind: "next_reply",
      cycleKey: "cycle-1",
      startedAt: new Date("2026-09-17T10:00:00.000Z"),
    });
    const cycle3 = commitment({
      id: "c-nr-3",
      kind: "next_reply",
      cycleKey: "cycle-3",
      startedAt: new Date("2026-09-17T14:00:00.000Z"),
    });
    const data = await getCaseDetailData(
      fakePrisma([cycle2, cycle1, cycle3]),
      "org-1",
      "case-1",
      AS_OF,
    );
    const numbers = nextReplyCycleNumbers(data!.commitments);
    expect(numbers.get("c-nr-1")).toBe(1);
    expect(numbers.get("c-nr-2")).toBe(2);
    expect(numbers.get("c-nr-3")).toBe(3);
  });

  it("renders distinguishable Cycle labels for two simultaneous Next Reply cards", async () => {
    const cycle1 = commitment({
      id: "c-nr-1",
      kind: "next_reply",
      cycleKey: "cycle-1",
      startedAt: new Date("2026-09-17T10:00:00.000Z"),
    });
    const cycle2 = commitment({
      id: "c-nr-2",
      kind: "next_reply",
      cycleKey: "cycle-2",
      startedAt: new Date("2026-09-17T12:00:00.000Z"),
    });
    const data = await getCaseDetailData(
      fakePrisma([cycle2, cycle1]),
      "org-1",
      "case-1",
      AS_OF,
    );
    const numbers = nextReplyCycleNumbers(data!.commitments);

    const renders = data!.commitments.map((c) =>
      renderToStaticMarkup(
        createElement(CommitmentCard, {
          commitment: c,
          cycleNumber: numbers.get(c.id),
        }),
      ).replace(/<[^>]+>/g, " "),
    );

    expect(renders[0]).toContain("Next reply");
    expect(renders[0]).toContain("Cycle 1");
    expect(renders[1]).toContain("Next reply");
    expect(renders[1]).toContain("Cycle 2");
  });

  it("does not label a first_response or resolution card with a cycle number", async () => {
    const firstResponse = commitment({
      id: "c-fr",
      kind: "first_response",
      cycleKey: "single",
    });
    const data = await getCaseDetailData(
      fakePrisma([firstResponse]),
      "org-1",
      "case-1",
      AS_OF,
    );
    const numbers = nextReplyCycleNumbers(data!.commitments);
    expect(numbers.has("c-fr")).toBe(false);

    const html = renderToStaticMarkup(
      createElement(CommitmentCard, {
        commitment: data!.commitments[0]!,
        cycleNumber: numbers.get("c-fr"),
      }),
    );
    expect(html).not.toContain("Cycle");
  });

  // Cancelled-commitment visibility: existing status/badge/label support
  // (StatusBadge, status-styles.ts, formatCommitmentStatus) already treats
  // "cancelled" as a normal, intentionally visible commitment status — the
  // case-list worst-status precedence includes it too. Next Reply keeps that
  // same behavior rather than inventing a hide-cancelled UX: a cancelled
  // cycle's commitment still appears in the case-detail commitment list.
  it("keeps a cancelled Next Reply commitment visible, like any other status", async () => {
    const cancelled = commitment({
      id: "c-nr-cancelled",
      kind: "next_reply",
      cycleKey: "cycle-gone",
      status: "cancelled",
      closedAt: new Date("2026-09-17T11:00:00.000Z"),
    });
    const data = await getCaseDetailData(
      fakePrisma([cancelled]),
      "org-1",
      "case-1",
      AS_OF,
    );
    expect(data!.commitments).toHaveLength(1);
    expect(data!.commitments[0]!.id).toBe("c-nr-cancelled");
    expect(data!.commitments[0]!.cycleKey).toBe("cycle-gone");
  });

  // Regression: case-detail-data.ts used to display `evaluation.status`
  // (evaluateCommitment's live re-evaluation) instead of the persisted
  // lifecycle status. evaluateCommitment has no notion of "cancelled" — it
  // only ever returns on_track/at_risk/met/breached — so a persisted
  // `cancelled` Next Reply commitment with no completion event would be
  // live re-evaluated against `asOf` (6 hours after it started, target 60m)
  // and surface as "breached" in the UI even though it was cancelled 30
  // minutes in. The fix must keep showing "cancelled", generically, off the
  // persisted `status` column, not by teaching the engine a new status.
  it("renders a cancelled commitment as cancelled, not recomputed as breached from live elapsed time", async () => {
    const cancelled = commitment({
      id: "c-nr-cancelled",
      kind: "next_reply",
      cycleKey: "cycle-gone",
      status: "cancelled",
      startedAt: OPENED, // 09:00
      closedAt: new Date("2026-09-17T09:30:00.000Z"), // cancelled 30m in
      targetMinutes: 60,
    });
    // AS_OF is 15:00 — 6 hours after startedAt, well past the 60m target,
    // which is exactly what would make a live re-evaluation say "breached".
    const data = await getCaseDetailData(
      fakePrisma([cancelled]),
      "org-1",
      "case-1",
      AS_OF,
    );
    const detail = data!.commitments[0]!;
    expect(detail.status).toBe("cancelled");
    expect(detail.status).not.toBe("breached");
    expect(detail.clockState).toBe("stopped");
    expect(detail.breachedBySeconds).toBeNull();
    expect(detail.pausedSince).toBeNull();
    expect(detail.effectiveDueAt).toBeNull();
    // Elapsed time is frozen at cancellation (30m), not the live 6h.
    expect(detail.elapsedSeconds).toBe(30 * 60);
  });

  it("still shows a finalized met commitment as met, unaffected by the cancelled-status fix", async () => {
    const startedAt = OPENED; // 09:00
    const met = commitment({
      id: "c-fr-met",
      kind: "first_response",
      cycleKey: "single",
      startedAt,
      targetMinutes: 120,
      status: "met",
      closedAt: new Date("2026-09-17T09:45:00.000Z"),
    });
    const reply = event({
      id: "ev-agent-reply",
      type: "agent_replied",
      occurredAt: new Date("2026-09-17T09:45:00.000Z"),
    });
    const data = await getCaseDetailData(
      fakePrisma([met], [reply]),
      "org-1",
      "case-1",
      AS_OF,
    );
    const detail = data!.commitments[0]!;
    expect(detail.status).toBe("met");
    expect(detail.clockState).toBe("stopped");
    expect(detail.breachedBySeconds).toBeNull();
    expect(detail.elapsedSeconds).toBe(45 * 60);
  });

  it("still shows a finalized breached commitment as breached, unaffected by the cancelled-status fix", async () => {
    const startedAt = OPENED; // 09:00
    const breached = commitment({
      id: "c-fr-breached",
      kind: "first_response",
      cycleKey: "single",
      startedAt,
      targetMinutes: 60,
      status: "breached",
      closedAt: new Date("2026-09-17T11:00:00.000Z"),
    });
    const reply = event({
      id: "ev-agent-reply-late",
      type: "agent_replied",
      occurredAt: new Date("2026-09-17T11:00:00.000Z"),
    });
    const data = await getCaseDetailData(
      fakePrisma([breached], [reply]),
      "org-1",
      "case-1",
      AS_OF,
    );
    const detail = data!.commitments[0]!;
    expect(detail.status).toBe("breached");
    expect(detail.clockState).toBe("stopped");
    expect(detail.breachedBySeconds).toBe(60 * 60);
  });
});
