import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@sla/db";
import {
  deriveNormalizedEventsForIssue,
  historyEntryOccurredAt,
  normalizeLinearStateType,
  resolveLinearActor,
  buildLinearBatch,
  sortHistoriesChronologically,
  UnknownLinearStateTypeError,
  type HistoryRecord,
} from "../src/normalize";
import type { LinearHistoryEntry, LinearIssue, LinearWorkflowState } from "../src/types";

const backlogState: LinearWorkflowState = { id: "s1", name: "Backlog", type: "backlog" };
const startedState: LinearWorkflowState = { id: "s2", name: "In Progress", type: "started" };
const completedState: LinearWorkflowState = { id: "s3", name: "Done", type: "completed" };

const issue: LinearIssue = {
  id: "issue-uuid-42",
  identifier: "ENG-42",
  title: "Customer escalation",
  url: "https://linear.app/acme/issue/ENG-42",
  priority: 2,
  createdAt: "2026-01-01T09:00:00.000Z",
  updatedAt: "2026-01-03T12:00:00.000Z",
  state: completedState,
  team: { id: "team-1", key: "ENG", name: "Engineering" },
  creator: { id: "user-customer", name: "Reporter" },
  assignee: { id: "user-agent", name: "Agent" },
};

function historyRecord(overrides: Partial<LinearHistoryEntry> & { id: string }): HistoryRecord {
  return {
    rawEventId: `raw_${overrides.id}`,
    entry: {
      actor: { id: "user-agent", name: "Agent" },
      createdAt: "2026-01-01T09:00:00.000Z",
      fromState: null,
      toState: null,
      ...overrides,
    },
  };
}

describe("normalizeLinearStateType", () => {
  it("maps every known type", () => {
    expect(normalizeLinearStateType("triage")).toBe("new");
    expect(normalizeLinearStateType("backlog")).toBe("open");
    expect(normalizeLinearStateType("unstarted")).toBe("open");
    expect(normalizeLinearStateType("started")).toBe("in_progress");
    expect(normalizeLinearStateType("completed")).toBe("resolved");
    expect(normalizeLinearStateType("canceled")).toBe("closed");
  });

  it("throws a named error on an unrecognized type", () => {
    expect(() => normalizeLinearStateType("bogus")).toThrow(UnknownLinearStateTypeError);
  });
});

describe("resolveLinearActor", () => {
  it("attributes a null actor (an automation acting without a user) to the system", () => {
    expect(resolveLinearActor(null, issue)).toBe("system");
    expect(resolveLinearActor(undefined, issue)).toBe("system");
  });

  it("attributes the issue's creator to the customer", () => {
    expect(resolveLinearActor({ id: "user-customer", name: "Reporter" }, issue)).toBe("customer");
  });

  it("defaults to agent for anyone else", () => {
    expect(resolveLinearActor({ id: "user-agent", name: "Agent" }, issue)).toBe("agent");
  });
});

describe("sortHistoriesChronologically", () => {
  it("orders by createdAt, then by entry id as a tiebreaker", () => {
    const a = historyRecord({ id: "c-300", createdAt: "2026-01-01T10:00:00Z" });
    const b = historyRecord({ id: "a-100", createdAt: "2026-01-01T09:00:00Z" });
    const c = historyRecord({ id: "b-200", createdAt: "2026-01-01T09:00:00Z" });
    expect(sortHistoriesChronologically([a, b, c]).map((r) => r.rawEventId)).toEqual([
      "raw_a-100",
      "raw_b-200",
      "raw_c-300",
    ]);
  });
});

describe("historyEntryOccurredAt", () => {
  const base = historyRecord({ id: "1", createdAt: "2026-01-01T09:00:00.000Z" }).entry;

  it("uses createdAt when the entry has no updatedAt (rows fetched before it was queried)", () => {
    expect(historyEntryOccurredAt(base)).toBe("2026-01-01T09:00:00.000Z");
  });

  it("uses updatedAt for an entry Linear rewrote in place after it was created", () => {
    expect(historyEntryOccurredAt({ ...base, updatedAt: "2026-01-01T10:30:00.000Z" })).toBe("2026-01-01T10:30:00.000Z");
  });

  it("never reports a time earlier than createdAt", () => {
    expect(historyEntryOccurredAt({ ...base, updatedAt: "2026-01-01T08:00:00.000Z" })).toBe("2026-01-01T09:00:00.000Z");
  });
});

describe("deriveNormalizedEventsForIssue", () => {
  it("dates a coalesced transition to when the entry was last rewritten, not when it was created", () => {
    const histories = [
      historyRecord({
        id: "1",
        createdAt: "2026-01-01T09:05:00Z",
        updatedAt: "2026-01-01T11:00:00Z",
        fromState: backlogState,
        toState: completedState,
      }),
    ];
    const events = deriveNormalizedEventsForIssue(issue, histories, "raw_issue_42");
    expect(events[1]?.occurredAt).toBe("2026-01-01T11:00:00Z");
  });

  it("synthesizes the initial event from the issue snapshot when there are no state-changing histories", () => {
    const events = deriveNormalizedEventsForIssue(issue, [], "raw_issue_42");
    expect(events).toEqual([
      {
        occurredAt: issue.createdAt,
        actor: "customer",
        fromState: null,
        toState: "resolved",
        sourceRawEventId: "raw_issue_42",
      },
    ]);
  });

  it("takes the initial state from the first state change's `fromState`", () => {
    const histories = [
      historyRecord({
        id: "1",
        createdAt: "2026-01-01T09:05:00Z",
        actor: { id: "user-agent", name: "Agent" },
        fromState: backlogState,
        toState: startedState,
      }),
    ];
    const events = deriveNormalizedEventsForIssue(issue, histories, "raw_issue_42");
    expect(events[0]).toMatchObject({ fromState: null, toState: "open" });
    expect(events[1]).toMatchObject({
      fromState: "open",
      toState: "in_progress",
      sourceRawEventId: "raw_1",
    });
  });

  it("emits one state_changed-shaped event per state transition, in order", () => {
    const histories = [
      historyRecord({
        id: "1",
        createdAt: "2026-01-01T09:05:00Z",
        fromState: backlogState,
        toState: startedState,
      }),
      historyRecord({
        id: "2",
        createdAt: "2026-01-02T09:00:00Z",
        fromState: startedState,
        toState: completedState,
      }),
    ];
    const events = deriveNormalizedEventsForIssue(issue, histories, "raw_issue_42");
    expect(events.map((e) => [e.fromState, e.toState])).toEqual([
      [null, "open"],
      ["open", "in_progress"],
      ["in_progress", "resolved"],
    ]);
  });

  it("resolves each transition's actor independently from its own history", () => {
    const histories = [
      historyRecord({
        id: "1",
        createdAt: "2026-01-01T09:05:00Z",
        actor: { id: "user-customer", name: "Reporter" },
        fromState: backlogState,
        toState: startedState,
      }),
      historyRecord({
        id: "2",
        createdAt: "2026-01-02T09:00:00Z",
        actor: null,
        fromState: startedState,
        toState: completedState,
      }),
    ];
    const events = deriveNormalizedEventsForIssue(issue, histories, "raw_issue_42");
    expect(events[1]?.actor).toBe("customer");
    expect(events[2]?.actor).toBe("system");
  });

  it("ignores history entries with no state change", () => {
    const histories = [
      historyRecord({ id: "1", createdAt: "2026-01-01T09:05:00Z", fromState: null, toState: null }),
    ];
    const events = deriveNormalizedEventsForIssue(issue, histories, "raw_issue_42");
    expect(events).toHaveLength(1);
  });

  it("throws a named error when a state's type isn't recognized", () => {
    const bogusState: LinearWorkflowState = { id: "s9", name: "???", type: "bogus" };
    const histories = [
      historyRecord({ id: "1", createdAt: "2026-01-01T09:05:00Z", fromState: backlogState, toState: bogusState }),
    ];
    expect(() => deriveNormalizedEventsForIssue(issue, histories, "raw_issue_42")).toThrow(
      UnknownLinearStateTypeError,
    );
  });
});

describe("buildLinearBatch — history entries rewritten in place", () => {
  interface FakeRawEvent {
    id: string;
    providerEventId: string;
    payload: unknown;
    fetchedAt: Date;
  }

  function fakePrisma(rawEvents: FakeRawEvent[]) {
    const prisma = {
      integration: { findUniqueOrThrow: async () => ({ id: "integ-1", organizationId: "org-1" }) },
      rawEvent: {
        findMany: async ({ where }: { where: { providerEventId?: { startsWith: string }; OR?: unknown[] } }) => {
          if (where.OR) return rawEvents.map(({ id }) => ({ id }));
          const prefix = where.providerEventId!.startsWith;
          return rawEvents.filter((row) => row.providerEventId.startsWith(prefix));
        },
      },
      caseLink: { findMany: async () => [{ caseId: "case-1", externalId: issue.identifier }] },
    } as unknown as PrismaClient;
    return { prisma };
  }

  /** The events the batch derives for the one linked issue, aimed at its case. */
  async function derivedEvents(prisma: PrismaClient) {
    const batch = await buildLinearBatch(prisma, "integ-1");
    expect(batch.failures).toEqual([]);
    expect(batch.eventGroups).toHaveLength(1);
    expect(batch.eventGroups[0]!.target).toEqual({ caseId: "case-1" });
    return batch.eventGroups[0]!.events;
  }

  it("projects the latest version of a rewritten entry, not the stale first fetch", async () => {
    const entry = (toState: LinearWorkflowState): LinearHistoryEntry => ({
      id: "h1",
      createdAt: "2026-01-01T10:00:00.000Z",
      actor: { id: "user-agent", name: "Agent" },
      fromState: backlogState,
      toState,
    });
    const { prisma } = fakePrisma([
      { id: "raw_issue", providerEventId: `issue:${issue.id}:hash`, payload: issue, fetchedAt: new Date("2026-01-01T10:01:00Z") },
      // First fetch (a row written before the hash suffix existed): Backlog -> Started.
      {
        id: "raw_h1_old",
        providerEventId: `issue_history:${issue.id}:h1`,
        payload: entry(startedState),
        fetchedAt: new Date("2026-01-01T10:01:00Z"),
      },
      // Linear later rewrote the same entry in place: Backlog -> Completed.
      {
        id: "raw_h1_new",
        providerEventId: `issue_history:${issue.id}:h1:newhash`,
        payload: entry(completedState),
        fetchedAt: new Date("2026-01-01T10:05:00Z"),
      },
    ]);

    const created = await derivedEvents(prisma);

    expect(created.map((e) => [e.fromState, e.toState, e.sourceSequence])).toEqual([
      [null, "open", 0],
      ["open", "resolved", 1],
    ]);
    expect(created[1]!.sourceRawEventId).toBe("raw_h1_new");
  });

  it("returns to the earlier state when an entry flips A → B → A (the third version must win)", async () => {
    const entry = (toState: LinearWorkflowState, updatedAt: string): LinearHistoryEntry => ({
      id: "h1",
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt,
      actor: { id: "user-agent", name: "Agent" },
      fromState: backlogState,
      toState,
    });
    const { prisma } = fakePrisma([
      { id: "raw_issue", providerEventId: `issue:${issue.id}:hash`, payload: issue, fetchedAt: new Date("2026-01-01T10:01:00Z") },
      { id: "raw_a1", providerEventId: `issue_history:${issue.id}:h1:a1`, payload: entry(startedState, "2026-01-01T10:10:00.000Z"), fetchedAt: new Date("2026-01-01T10:11:00Z") },
      { id: "raw_b", providerEventId: `issue_history:${issue.id}:h1:b`, payload: entry(completedState, "2026-01-01T10:20:00.000Z"), fetchedAt: new Date("2026-01-01T10:21:00Z") },
      { id: "raw_a2", providerEventId: `issue_history:${issue.id}:h1:a2`, payload: entry(startedState, "2026-01-01T10:30:00.000Z"), fetchedAt: new Date("2026-01-01T10:31:00Z") },
    ]);

    const created = await derivedEvents(prisma);

    expect(created.map((e) => [e.fromState, e.toState])).toEqual([
      [null, "open"],
      ["open", "in_progress"],
    ]);
    expect(created[1]!.sourceRawEventId).toBe("raw_a2");
  });

  it("ranks versions by the entry's updatedAt even when an older version was stored later", async () => {
    const entry = (toState: LinearWorkflowState, updatedAt: string): LinearHistoryEntry => ({
      id: "h1",
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt,
      actor: { id: "user-agent", name: "Agent" },
      fromState: backlogState,
      toState,
    });
    const { prisma } = fakePrisma([
      { id: "raw_issue", providerEventId: `issue:${issue.id}:hash`, payload: issue, fetchedAt: new Date("2026-01-01T10:01:00Z") },
      // Newer version stored first (e.g. the worker raced a manual backfill) ...
      { id: "raw_new", providerEventId: `issue_history:${issue.id}:h1:new`, payload: entry(completedState, "2026-01-01T10:30:00.000Z"), fetchedAt: new Date("2026-01-01T10:31:00Z") },
      // ... and a stale version landed afterwards.
      { id: "raw_old", providerEventId: `issue_history:${issue.id}:h1:old`, payload: entry(startedState, "2026-01-01T10:10:00.000Z"), fetchedAt: new Date("2026-01-01T10:32:00Z") },
    ]);

    const created = await derivedEvents(prisma);

    expect(created[1]).toMatchObject({ toState: "resolved", sourceRawEventId: "raw_new" });
  });

  it("prefers a row carrying updatedAt over a legacy row without one, whatever their fetch order", async () => {
    const { prisma } = fakePrisma([
      { id: "raw_issue", providerEventId: `issue:${issue.id}:hash`, payload: issue, fetchedAt: new Date("2026-01-01T10:01:00Z") },
      {
        id: "raw_legacy",
        providerEventId: `issue_history:${issue.id}:h1`,
        payload: { id: "h1", createdAt: "2026-01-01T10:00:00.000Z", actor: null, fromState: backlogState, toState: completedState },
        fetchedAt: new Date("2026-01-01T10:40:00Z"),
      },
      {
        id: "raw_current",
        providerEventId: `issue_history:${issue.id}:h1:cur`,
        payload: { id: "h1", createdAt: "2026-01-01T10:00:00.000Z", updatedAt: "2026-01-01T10:30:00.000Z", actor: null, fromState: backlogState, toState: startedState },
        fetchedAt: new Date("2026-01-01T10:31:00Z"),
      },
    ]);

    const created = await derivedEvents(prisma);

    expect(created[1]).toMatchObject({ toState: "in_progress", sourceRawEventId: "raw_current" });
  });
});
