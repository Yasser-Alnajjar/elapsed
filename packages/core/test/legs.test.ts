import { withSourceRole } from "./source-role";
import { describe, expect, it } from "vitest";
import { deriveLegSpans, legAtTime, sumLegMinutes, validateLegSpans } from "../src/legs.js";
import type { LegSpan, NormalizedEvent } from "../src/types";

let seq = 0;
function event(
  partial: Partial<NormalizedEvent> &
    Pick<NormalizedEvent, "occurredAt" | "system" | "type">,
): NormalizedEvent {
  seq += 1;
  return withSourceRole({
    id: `evt-${seq}`,
    caseId: "case-1",
    actor: "agent",
    fromState: null,
    toState: null,
    sourceRawEventId: `raw-${seq}`,
    ...partial,
  });
}

describe("deriveLegSpans", () => {
  it("derives a clean handoff timeline: support -> engineering -> support -> waiting_customer -> support", () => {
    const events = [
      event({
        type: "case_created",
        system: "zendesk",
        toState: "open",
        occurredAt: "2026-09-07T09:00:00.000Z",
      }),
      event({
        type: "issue_linked",
        system: "jira",
        occurredAt: "2026-09-07T10:00:00.000Z",
      }),
      event({
        type: "issue_unlinked",
        system: "jira",
        occurredAt: "2026-09-07T11:00:00.000Z",
      }),
      event({
        type: "state_changed",
        system: "zendesk",
        fromState: "open",
        toState: "pending_customer",
        occurredAt: "2026-09-07T12:00:00.000Z",
      }),
      event({
        type: "state_changed",
        system: "zendesk",
        fromState: "pending_customer",
        toState: "open",
        occurredAt: "2026-09-07T13:00:00.000Z",
      }),
    ];

    const { spans, warnings } = deriveLegSpans(events);

    expect(warnings).toHaveLength(0);
    expect(
      spans.map((s) => [s.leg, s.confidence, s.startedAt, s.endedAt]),
    ).toEqual([
      [
        "support",
        "certain",
        "2026-09-07T09:00:00.000Z",
        "2026-09-07T10:00:00.000Z",
      ],
      [
        "engineering",
        "certain",
        "2026-09-07T10:00:00.000Z",
        "2026-09-07T11:00:00.000Z",
      ],
      [
        "support",
        "certain",
        "2026-09-07T11:00:00.000Z",
        "2026-09-07T12:00:00.000Z",
      ],
      [
        "waiting_customer",
        "certain",
        "2026-09-07T12:00:00.000Z",
        "2026-09-07T13:00:00.000Z",
      ],
      ["support", "certain", "2026-09-07T13:00:00.000Z", null],
    ]);
  });

  it("emits an unknown span with a warning on an ambiguous (contemporaneous) handoff", () => {
    const events = [
      event({
        type: "case_created",
        system: "zendesk",
        toState: "open",
        occurredAt: "2026-09-07T09:00:00.000Z",
      }),
      event({
        type: "issue_linked",
        system: "jira",
        occurredAt: "2026-09-07T10:00:00.000Z",
      }),
      event({
        type: "issue_unlinked",
        system: "jira",
        occurredAt: "2026-09-07T10:00:00.000Z",
      }),
    ];

    const { spans, warnings } = deriveLegSpans(events);

    expect(warnings.some((w) => w.kind === "ambiguous_handoff")).toBe(true);
    const ambiguousSpan = spans.find(
      (s) => s.startedAt === "2026-09-07T10:00:00.000Z",
    );
    expect(ambiguousSpan?.leg).toBe("unknown");
    expect(ambiguousSpan?.confidence).toBe("unknown");
  });

  it("bounds a missing handoff event to the case's open time and marks it inferred", () => {
    const events = [
      event({
        type: "issue_linked",
        system: "jira",
        occurredAt: "2026-09-07T09:00:00.000Z",
      }),
    ];

    const { spans } = deriveLegSpans(events, {
      caseOpenedAt: "2026-09-07T08:00:00.000Z",
    });

    expect(spans[0]).toMatchObject({
      leg: "engineering",
      confidence: "inferred",
      startedAt: "2026-09-07T08:00:00.000Z",
    });
    expect(spans[0]?.note).toContain("bounded by case open");
  });

  it("attributes multiple linked issues to a single engineering leg and notes the count", () => {
    const events = [
      event({
        type: "case_created",
        system: "zendesk",
        toState: "open",
        occurredAt: "2026-09-07T09:00:00.000Z",
      }),
      event({
        type: "issue_linked",
        system: "jira",
        occurredAt: "2026-09-07T10:00:00.000Z",
      }),
      event({
        type: "issue_linked",
        system: "jira",
        occurredAt: "2026-09-07T11:00:00.000Z",
      }),
    ];

    const { spans } = deriveLegSpans(events);
    const engineeringSpan = spans.find((s) => s.leg === "engineering");

    expect(engineeringSpan?.note).toBe(
      "2 linked issues — attributed as one engineering leg",
    );
  });

  it("attributes a Linear-linked issue to the engineering leg the same way as a Jira one", () => {
    const events = [
      event({
        type: "case_created",
        system: "zendesk",
        toState: "open",
        occurredAt: "2026-09-07T09:00:00.000Z",
      }),
      event({
        type: "issue_linked",
        system: "linear",
        occurredAt: "2026-09-07T10:00:00.000Z",
      }),
    ];

    const { spans } = deriveLegSpans(events);
    expect(spans[spans.length - 1]).toMatchObject({ leg: "engineering", confidence: "certain" });
  });

  it("ends the engineering leg once the linked issue resolves, regardless of which tracker it's in", () => {
    const events = [
      event({
        type: "case_created",
        system: "zendesk",
        toState: "open",
        occurredAt: "2026-09-07T09:00:00.000Z",
      }),
      event({
        type: "issue_linked",
        system: "linear",
        occurredAt: "2026-09-07T10:00:00.000Z",
      }),
      event({
        type: "state_changed",
        system: "linear",
        fromState: "in_progress",
        toState: "resolved",
        occurredAt: "2026-09-07T11:00:00.000Z",
      }),
    ];

    const { spans } = deriveLegSpans(events);
    expect(
      spans.map((s) => [s.leg, s.startedAt, s.endedAt]),
    ).toEqual([
      ["support", "2026-09-07T09:00:00.000Z", "2026-09-07T10:00:00.000Z"],
      ["engineering", "2026-09-07T10:00:00.000Z", "2026-09-07T11:00:00.000Z"],
      ["support", "2026-09-07T11:00:00.000Z", null],
    ]);
  });

  it("attributes a GitHub-linked pull request to the engineering leg the same way as Jira/Linear", () => {
    const events = [
      event({
        type: "case_created",
        system: "zendesk",
        toState: "open",
        occurredAt: "2026-09-07T09:00:00.000Z",
      }),
      event({
        type: "issue_linked",
        system: "github",
        occurredAt: "2026-09-07T10:00:00.000Z",
      }),
    ];

    const { spans } = deriveLegSpans(events);
    expect(spans[spans.length - 1]).toMatchObject({ leg: "engineering", confidence: "certain" });
  });

  it("ends the engineering leg once a linked GitHub pull request merges", () => {
    const events = [
      event({
        type: "case_created",
        system: "zendesk",
        toState: "open",
        occurredAt: "2026-09-07T09:00:00.000Z",
      }),
      event({
        type: "issue_linked",
        system: "github",
        occurredAt: "2026-09-07T10:00:00.000Z",
      }),
      event({
        type: "state_changed",
        system: "github",
        fromState: "in_progress",
        toState: "resolved",
        occurredAt: "2026-09-07T11:00:00.000Z",
      }),
    ];

    const { spans } = deriveLegSpans(events);
    expect(
      spans.map((s) => [s.leg, s.startedAt, s.endedAt]),
    ).toEqual([
      ["support", "2026-09-07T09:00:00.000Z", "2026-09-07T10:00:00.000Z"],
      ["engineering", "2026-09-07T10:00:00.000Z", "2026-09-07T11:00:00.000Z"],
      ["support", "2026-09-07T11:00:00.000Z", null],
    ]);
  });

  it("never guesses: absent signals produce an unknown span rather than a default leg", () => {
    const noSignalEvents = [
      event({
        type: "case_created",
        system: "zendesk",
        toState: null,
        occurredAt: "2026-09-07T09:00:00.000Z",
      }),
    ];
    const { spans } = deriveLegSpans(noSignalEvents);
    expect(spans[0]).toMatchObject({ leg: "unknown", confidence: "unknown" });
  });
});

describe("validateLegSpans", () => {
  it("flags a negative-duration span without altering it", () => {
    const spans: LegSpan[] = [
      {
        leg: "support",
        confidence: "certain",
        startedAt: "2026-09-07T12:00:00.000Z",
        endedAt: "2026-09-07T10:00:00.000Z",
      },
    ];
    const warnings = validateLegSpans(spans);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("impossible_span");
    expect(spans[0]?.endedAt).toBe("2026-09-07T10:00:00.000Z"); // untouched — never silently normalized
  });

  it("flags overlapping consecutive spans", () => {
    const spans: LegSpan[] = [
      {
        leg: "support",
        confidence: "certain",
        startedAt: "2026-09-07T09:00:00.000Z",
        endedAt: "2026-09-07T12:00:00.000Z",
      },
      {
        leg: "engineering",
        confidence: "certain",
        startedAt: "2026-09-07T11:00:00.000Z",
        endedAt: null,
      },
    ];
    const warnings = validateLegSpans(spans);
    expect(warnings.some((w) => w.kind === "impossible_span")).toBe(true);
  });

  it("returns no warnings for a well-formed, contiguous timeline", () => {
    const spans: LegSpan[] = [
      {
        leg: "support",
        confidence: "certain",
        startedAt: "2026-09-07T09:00:00.000Z",
        endedAt: "2026-09-07T10:00:00.000Z",
      },
      {
        leg: "engineering",
        confidence: "certain",
        startedAt: "2026-09-07T10:00:00.000Z",
        endedAt: null,
      },
    ];
    expect(validateLegSpans(spans)).toHaveLength(0);
  });
});

describe("sumLegMinutes", () => {
  it("sums a single closed span", () => {
    const spans: LegSpan[] = [
      {
        leg: "engineering",
        confidence: "certain",
        startedAt: "2026-09-07T09:00:00.000Z",
        endedAt: "2026-09-07T11:00:00.000Z",
      },
    ];
    expect(sumLegMinutes(spans, "engineering", "2026-09-07T12:00:00.000Z")).toBe(120);
  });

  it("bounds a still-open span by asOf", () => {
    const spans: LegSpan[] = [
      {
        leg: "engineering",
        confidence: "certain",
        startedAt: "2026-09-07T09:00:00.000Z",
        endedAt: null,
      },
    ];
    expect(sumLegMinutes(spans, "engineering", "2026-09-07T09:30:00.000Z")).toBe(30);
  });

  it("accumulates across multiple non-contiguous spans of the same leg", () => {
    const spans: LegSpan[] = [
      {
        leg: "engineering",
        confidence: "certain",
        startedAt: "2026-09-07T09:00:00.000Z",
        endedAt: "2026-09-07T10:00:00.000Z",
      },
      {
        leg: "support",
        confidence: "certain",
        startedAt: "2026-09-07T10:00:00.000Z",
        endedAt: "2026-09-07T10:30:00.000Z",
      },
      {
        leg: "engineering",
        confidence: "certain",
        startedAt: "2026-09-07T10:30:00.000Z",
        endedAt: null,
      },
    ];
    expect(sumLegMinutes(spans, "engineering", "2026-09-07T11:00:00.000Z")).toBe(90);
  });

  it("returns 0 when the leg never occurs", () => {
    const spans: LegSpan[] = [
      {
        leg: "support",
        confidence: "certain",
        startedAt: "2026-09-07T09:00:00.000Z",
        endedAt: null,
      },
    ];
    expect(sumLegMinutes(spans, "engineering", "2026-09-07T12:00:00.000Z")).toBe(0);
  });
});

describe("legAtTime", () => {
  const spans: LegSpan[] = [
    {
      leg: "support",
      confidence: "certain",
      startedAt: "2026-09-07T09:00:00.000Z",
      endedAt: "2026-09-07T10:00:00.000Z",
    },
    {
      leg: "engineering",
      confidence: "certain",
      startedAt: "2026-09-07T10:00:00.000Z",
      endedAt: "2026-09-07T11:00:00.000Z",
    },
    {
      leg: "waiting_customer",
      confidence: "certain",
      startedAt: "2026-09-07T11:00:00.000Z",
      endedAt: null,
    },
  ];

  it("returns the leg whose span contains the instant", () => {
    expect(legAtTime(spans, "2026-09-07T10:30:00.000Z")).toBe("engineering");
  });

  it("treats a span boundary as belonging to the span that starts there", () => {
    expect(legAtTime(spans, "2026-09-07T10:00:00.000Z")).toBe("engineering");
  });

  it("resolves into the still-open final span", () => {
    expect(legAtTime(spans, "2026-09-08T00:00:00.000Z")).toBe("waiting_customer");
  });

  it("returns unknown when the instant is before every span", () => {
    expect(legAtTime(spans, "2026-09-07T08:00:00.000Z")).toBe("unknown");
  });

  it("returns unknown for an empty span list", () => {
    expect(legAtTime([], "2026-09-07T10:00:00.000Z")).toBe("unknown");
  });
});

describe("deriveLegSpans with out-of-order and empty event lists", () => {
  it("returns no spans and no warnings for an empty event list", () => {
    expect(deriveLegSpans([])).toEqual({ spans: [], warnings: [] });
    expect(deriveLegSpans([], { caseOpenedAt: "2026-09-07T08:00:00.000Z" })).toEqual({ spans: [], warnings: [] });
  });

  const chronological = [
    event({ type: "case_created", system: "zendesk", toState: "open", occurredAt: "2026-09-07T09:00:00.000Z" }),
    event({ type: "issue_linked", system: "jira", occurredAt: "2026-09-07T10:00:00.000Z" }),
    event({ type: "state_changed", system: "jira", toState: "resolved", occurredAt: "2026-09-07T11:00:00.000Z" }),
    event({
      type: "state_changed",
      system: "zendesk",
      fromState: "open",
      toState: "pending_customer",
      occurredAt: "2026-09-07T12:00:00.000Z",
    }),
    event({
      type: "state_changed",
      system: "zendesk",
      fromState: "pending_customer",
      toState: "open",
      occurredAt: "2026-09-07T13:00:00.000Z",
    }),
  ];

  it("derives the same timeline from a shuffled event list", () => {
    const expected = deriveLegSpans(chronological);
    expect(expected.warnings).toHaveLength(0);
    expect(expected.spans.map((s) => [s.leg, s.startedAt, s.endedAt])).toEqual([
      ["support", "2026-09-07T09:00:00.000Z", "2026-09-07T10:00:00.000Z"],
      ["engineering", "2026-09-07T10:00:00.000Z", "2026-09-07T11:00:00.000Z"],
      ["support", "2026-09-07T11:00:00.000Z", "2026-09-07T12:00:00.000Z"],
      ["waiting_customer", "2026-09-07T12:00:00.000Z", "2026-09-07T13:00:00.000Z"],
      ["support", "2026-09-07T13:00:00.000Z", null],
    ]);

    const shuffles = [
      [...chronological].reverse(),
      [chronological[3]!, chronological[0]!, chronological[4]!, chronological[2]!, chronological[1]!],
      [chronological[1]!, chronological[4]!, chronological[2]!, chronological[0]!, chronological[3]!],
    ];
    for (const shuffled of shuffles) {
      expect(deriveLegSpans(shuffled)).toEqual(expected);
    }
  });

  it("does not mutate the caller's event array while sorting", () => {
    const reversed = [...chronological].reverse();
    const snapshot = reversed.map((e) => e.id);
    deriveLegSpans(reversed);
    expect(reversed.map((e) => e.id)).toEqual(snapshot);
  });

  it("starts the timeline at the earliest event even when it arrives last, and applies the backfill bound to it", () => {
    const shuffled = [...chronological.slice(1), chronological[0]!];
    const { spans } = deriveLegSpans(shuffled, { caseOpenedAt: "2026-09-07T08:30:00.000Z" });
    expect(spans[0]).toMatchObject({
      leg: "support",
      confidence: "inferred",
      startedAt: "2026-09-07T08:30:00.000Z",
      endedAt: "2026-09-07T10:00:00.000Z",
    });
    expect(spans.slice(1).every((s) => s.confidence === "certain")).toBe(true);
  });

  it("still flags a contemporaneous link/unlink as ambiguous regardless of their order in the list", () => {
    const at = "2026-09-07T10:00:00.000Z";
    const created = event({ type: "case_created", system: "zendesk", toState: "open", occurredAt: "2026-09-07T09:00:00.000Z" });
    const unlink = event({ type: "issue_unlinked", system: "jira", occurredAt: at });
    const link = event({ type: "issue_linked", system: "jira", occurredAt: at });

    for (const events of [
      [created, link, unlink],
      [unlink, created, link],
      [link, unlink, created],
    ]) {
      const { spans, warnings } = deriveLegSpans(events);
      expect(warnings.map((w) => w.kind)).toEqual(["ambiguous_handoff"]);
      expect(spans.map((s) => s.leg)).toEqual(["support", "unknown"]);
    }
  });
});

describe("deriveLegSpans decides by sourceRole, not by system name (N1.7)", () => {
  const T = (m: number) => `2026-09-07T${String(9 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00.000Z`;
  const legs = (events: NormalizedEvent[]) => deriveLegSpans(events).spans.map((s) => s.leg);

  it("opaque system names give the same timeline as the provider names", () => {
    const build = (ticket: string, tracker: string) => [
      event({ type: "case_created", system: ticket, sourceRole: "ticket_source", toState: "open", occurredAt: T(0) }),
      event({ type: "issue_linked", system: tracker, sourceRole: "work_tracker", occurredAt: T(60) }),
      event({ type: "state_changed", system: tracker, sourceRole: "work_tracker", toState: "resolved", occurredAt: T(120) }),
      event({ type: "state_changed", system: ticket, sourceRole: "ticket_source", toState: "pending_customer", occurredAt: T(180) }),
    ];
    expect(deriveLegSpans(build("ticket-a", "tracker-a"))).toEqual(deriveLegSpans(build("zendesk", "jira")));
    expect(legs(build("ticket-a", "tracker-a"))).toEqual(["support", "engineering", "support", "waiting_customer"]);
  });

  it("a code_host event feeds the engineering state exactly like a work_tracker event", () => {
    for (const role of ["work_tracker", "code_host"] as const) {
      const events = [
        event({ type: "case_created", system: "s", sourceRole: "ticket_source", toState: "open", occurredAt: T(0) }),
        event({ type: "issue_linked", system: "t", sourceRole: role, occurredAt: T(60) }),
        event({ type: "state_changed", system: "t", sourceRole: role, toState: "resolved", occurredAt: T(120) }),
      ];
      expect(legs(events)).toEqual(["support", "engineering", "support"]);
    }
  });

  it("a provider-named system with a tracker role never drives the helpdesk state", () => {
    // Named "zendesk" but stored as a tracker: pending_customer must not read as the customer owing a reply.
    const events = [
      event({ type: "case_created", system: "ticket-a", sourceRole: "ticket_source", toState: "open", occurredAt: T(0) }),
      event({ type: "state_changed", system: "zendesk", sourceRole: "work_tracker", toState: "pending_customer", occurredAt: T(60) }),
    ];
    expect(legs(events)).toEqual(["support"]);
  });

  it("no ticket-source state yet stays unknown, even with tracker events present", () => {
    const events = [event({ type: "state_changed", system: "t", sourceRole: "work_tracker", toState: "in_progress", occurredAt: T(0) })];
    expect(legs(events)).toEqual(["unknown"]);
  });
});
