import { describe, expect, it } from "vitest";
import { diffNormalizedEvents } from "@sla/ingestion";

const base = {
  sourceRawEventId: "raw_1",
  sourceSequence: 0,
  type: "agent_replied",
  actor: "agent",
  fromState: null,
  toState: null,
};
const at = (iso: string) => new Date(iso);

describe("diffNormalizedEvents", () => {
  it("keeps identical events, creates new ones and deletes vanished ones", () => {
    const stored = [
      { id: "a", ...base, occurredAt: at("2026-09-01T09:00:00Z") },
      { id: "b", ...base, sourceSequence: 1, occurredAt: at("2026-09-01T09:05:00Z") },
    ];
    const derived = [
      { ...base, occurredAt: "2026-09-01T09:00:00.000Z" },
      { ...base, sourceSequence: 2, occurredAt: "2026-09-01T09:10:00.000Z" },
    ];

    const { toCreate, toDeleteIds } = diffNormalizedEvents(stored, derived);

    expect(toCreate).toEqual([derived[1]]);
    expect(toDeleteIds).toEqual(["b"]);
  });

  it("writes nothing when stored and derived match", () => {
    const stored = [{ id: "a", ...base, occurredAt: at("2026-09-01T09:00:00Z") }];
    const derived = [{ ...base, occurredAt: "2026-09-01T09:00:00Z" }];
    expect(diffNormalizedEvents(stored, derived)).toEqual({ toCreate: [], toDeleteIds: [] });
  });

  it("matches identical events one-to-one instead of collapsing them", () => {
    const occurredAt = at("2026-09-01T09:00:00Z");
    const stored = [
      { id: "a", ...base, occurredAt },
      { id: "b", ...base, occurredAt },
    ];
    const derived = [{ ...base, occurredAt: occurredAt.toISOString() }];

    const { toCreate, toDeleteIds } = diffNormalizedEvents(stored, derived);

    expect(toCreate).toEqual([]);
    expect(toDeleteIds).toHaveLength(1);
  });

  it("treats any changed field as a different event", () => {
    const stored = [{ id: "a", ...base, occurredAt: at("2026-09-01T09:00:00Z") }];
    for (const change of [{ actor: "customer" }, { type: "customer_replied" }, { toState: "open" }, { fromState: "new" }]) {
      const { toCreate, toDeleteIds } = diffNormalizedEvents(stored, [
        { ...base, ...change, occurredAt: "2026-09-01T09:00:00Z" },
      ]);
      expect(toCreate).toHaveLength(1);
      expect(toDeleteIds).toEqual(["a"]);
    }
  });

  it("treats a stored event without a source role as different from its derived twin", () => {
    const stored = [{ id: "a", ...base, sourceRole: null, occurredAt: at("2026-09-01T09:00:00Z") }];
    const derived = [{ ...base, sourceRole: "ticket_source", occurredAt: "2026-09-01T09:00:00.000Z" }];

    const { toCreate, toDeleteIds } = diffNormalizedEvents(stored, derived);

    expect(toCreate).toEqual(derived);
    expect(toDeleteIds).toEqual(["a"]);
  });

  it("keeps a stored event whose source role matches", () => {
    const stored = [{ id: "a", ...base, sourceRole: "ticket_source", occurredAt: at("2026-09-01T09:00:00Z") }];
    const derived = [{ ...base, sourceRole: "ticket_source", occurredAt: "2026-09-01T09:00:00.000Z" }];

    expect(diffNormalizedEvents(stored, derived)).toEqual({ toCreate: [], toDeleteIds: [] });
  });
});
