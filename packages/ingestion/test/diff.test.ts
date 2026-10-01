import { describe, expect, it } from "vitest";
import { diffNormalizedEvents } from "../src";

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

  it("matches events with the same content one-to-one", () => {
    const stored = [{ id: "a", ...base, occurredAt: at("2026-09-01T09:00:00Z") }];
    const derived = [
      { ...base, occurredAt: at("2026-09-01T09:00:00Z") },
      { ...base, occurredAt: at("2026-09-01T09:00:00Z") },
    ];
    const { toCreate, toDeleteIds } = diffNormalizedEvents(stored, derived);
    expect(toCreate).toHaveLength(1);
    expect(toDeleteIds).toEqual([]);
  });

  it("replaces a stored event with no source role", () => {
    const stored = [{ id: "a", ...base, sourceRole: null, occurredAt: at("2026-09-01T09:00:00Z") }];
    const derived = [{ ...base, sourceRole: "ticket_source", occurredAt: at("2026-09-01T09:00:00Z") }];
    const { toCreate, toDeleteIds } = diffNormalizedEvents(stored, derived);
    expect(toCreate).toEqual(derived);
    expect(toDeleteIds).toEqual(["a"]);
  });

  it("writes nothing when nothing changed", () => {
    const stored = [{ id: "a", ...base, occurredAt: at("2026-09-01T09:00:00Z") }];
    expect(diffNormalizedEvents(stored, [{ ...base, occurredAt: at("2026-09-01T09:00:00Z") }])).toEqual({
      toCreate: [],
      toDeleteIds: [],
    });
  });
});
