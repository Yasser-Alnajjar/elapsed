import { describe, expect, it } from "vitest";
import {
  formatCaseKey,
  formatCommitmentKind,
  formatNextCycle,
  formatTicketSourceShort,
  nextReplyCycleNumbers,
} from "../src/lib/format";

describe("formatCommitmentKind", () => {
  it("labels every CommitmentKind", () => {
    expect(formatCommitmentKind("first_response")).toBe("First response");
    expect(formatCommitmentKind("resolution")).toBe("Resolution");
    expect(formatCommitmentKind("next_reply")).toBe("Next reply");
  });
});

describe("nextReplyCycleNumbers", () => {
  it("numbers next_reply commitments 1-based, in startedAt order, regardless of input order", () => {
    const commitments = [
      { id: "c2", kind: "next_reply" as const, startedAt: "2026-09-17T12:00:00.000Z" },
      { id: "c1", kind: "next_reply" as const, startedAt: "2026-09-17T10:00:00.000Z" },
      { id: "c3", kind: "next_reply" as const, startedAt: "2026-09-17T14:00:00.000Z" },
    ];
    const numbers = nextReplyCycleNumbers(commitments);
    expect(numbers.get("c1")).toBe(1);
    expect(numbers.get("c2")).toBe(2);
    expect(numbers.get("c3")).toBe(3);
  });

  it("excludes first_response and resolution from the map", () => {
    const commitments = [
      { id: "fr", kind: "first_response" as const, startedAt: "2026-09-17T09:00:00.000Z" },
      { id: "res", kind: "resolution" as const, startedAt: "2026-09-17T09:00:00.000Z" },
      { id: "nr", kind: "next_reply" as const, startedAt: "2026-09-17T10:00:00.000Z" },
    ];
    const numbers = nextReplyCycleNumbers(commitments);
    expect(numbers.has("fr")).toBe(false);
    expect(numbers.has("res")).toBe(false);
    expect(numbers.get("nr")).toBe(1);
  });

  it("does not mutate the input array while sorting", () => {
    const commitments = [
      { id: "c2", kind: "next_reply" as const, startedAt: "2026-09-17T12:00:00.000Z" },
      { id: "c1", kind: "next_reply" as const, startedAt: "2026-09-17T10:00:00.000Z" },
    ];
    const snapshot = commitments.map((c) => c.id);
    nextReplyCycleNumbers(commitments);
    expect(commitments.map((c) => c.id)).toEqual(snapshot);
  });

  it("returns an empty map when there are no next_reply commitments", () => {
    expect(nextReplyCycleNumbers([{ id: "fr", kind: "first_response" as const, startedAt: "2026-09-17T09:00:00.000Z" }]).size).toBe(0);
  });
});

describe("formatNextCycle", () => {
  const now = Date.parse("2026-10-01T01:00:00Z");
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  it("reads pending when the worker has not armed a timer yet", () => {
    expect(formatNextCycle(null, now)).toBe("Pending first cycle");
  });

  it("rounds to seconds, minutes, then hours", () => {
    expect(formatNextCycle(at(13_400), now)).toBe("Next cycle in ~13 seconds");
    expect(formatNextCycle(at(800), now)).toBe("Next cycle in ~1 second");
    expect(formatNextCycle(at(13 * 60_000), now)).toBe("Next cycle in ~13 minutes");
    expect(formatNextCycle(at(2 * 3_600_000), now)).toBe("Next cycle in ~2 hours");
  });

  it("reads due now once the time has passed", () => {
    expect(formatNextCycle(at(-5_000), now)).toBe("Next cycle due now");
  });
});

describe("formatCaseKey", () => {
  it("keeps each ticket source's own prefix, so an Intercom case is never labelled as Zendesk", () => {
    expect(formatCaseKey("zendesk", "8921")).toBe("ZD-8921");
    expect(formatCaseKey("intercom", "7001")).toBe("IC-7001");
  });

  it("falls back to a bare id for a source with no prefix", () => {
    expect(formatCaseKey("zoho_desk", "12")).toBe("#12");
  });
});

describe("formatTicketSourceShort", () => {
  it("labels the case's own source in the list's state chip", () => {
    expect(formatTicketSourceShort("zendesk")).toBe("ZD");
    expect(formatTicketSourceShort("intercom")).toBe("IC");
  });
});
