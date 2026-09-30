import { describe, expect, it } from "vitest";
import { findCaseCloseEvent, findFirstResponseEvent, resolveFirstResponseStartedAt } from "../src/evaluate";
import { deriveNextReplyCycles } from "../src/reply-cycles";
import { eventsForPauseFold } from "../src/clock-rules";
import { isTicketSourceEvent } from "../src/ticket-source";
import type { NormalizedEvent, SourceRole } from "../src/types";
import { roleOf } from "./source-role";

const ROLES: SourceRole[] = ["ticket_source", "work_tracker", "code_host"];
const SYSTEMS = ["zendesk", "intercom", "jira", "linear", "github", "ticket-a", "anything"];

let seq = 0;
function event(
  system: string,
  sourceRole: SourceRole,
  type: NormalizedEvent["type"],
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    caseId: "case-1",
    type,
    occurredAt: `2026-09-17T09:${String(seq % 60).padStart(2, "0")}:00.000Z`,
    actor: "agent",
    system,
    sourceRole,
    fromState: null,
    toState: null,
    sourceRawEventId: `raw-${seq}`,
    ...overrides,
  };
}

describe("isTicketSourceEvent", () => {
  it("is true only for the ticket_source role, for every role", () => {
    expect(ROLES.map((role) => [role, isTicketSourceEvent({ sourceRole: role })])).toEqual([
      ["ticket_source", true],
      ["work_tracker", false],
      ["code_host", false],
    ]);
  });

  it("decides by role and never by the system string", () => {
    for (const system of SYSTEMS) {
      for (const role of ROLES) {
        expect(isTicketSourceEvent(event(system, role, "case_created"))).toBe(role === "ticket_source");
      }
    }
  });

  it("agrees with the role each existing provider is stored under", () => {
    // The N1.5 backfill maps each provider to these roles; the predicate must match today's set.
    const legacy = new Set(["zendesk", "intercom"]);
    for (const system of ["zendesk", "intercom", "jira", "linear", "github"]) {
      expect(isTicketSourceEvent({ sourceRole: roleOf(system) })).toBe(legacy.has(system));
    }
  });
});

describe("the engine follows the role at every call site", () => {
  const asOf = "2026-09-17T23:00:00.000Z";

  it("a provider-named system with a non-ticket role never anchors lifecycle, replies or first response", () => {
    // Named like a ticket source, but tracker role: must be ignored everywhere.
    const impostor = [
      event("zendesk", "work_tracker", "case_created", { actor: "agent" }),
      event("zendesk", "work_tracker", "agent_replied"),
      event("zendesk", "work_tracker", "customer_replied", { actor: "customer" }),
      event("zendesk", "work_tracker", "case_closed", { toState: "resolved" }),
    ];
    expect(findCaseCloseEvent(impostor, asOf)).toBeNull();
    expect(findFirstResponseEvent(impostor, asOf)).toBeNull();
    expect(resolveFirstResponseStartedAt(impostor, "2026-09-17T08:00:00.000Z")).toBe("2026-09-17T08:00:00.000Z");
    expect(deriveNextReplyCycles(impostor, { asOf })).toEqual([]);
  });

  it("an opaque system with the ticket role anchors them", () => {
    const opaque = [
      event("ticket-a", "ticket_source", "case_created", { actor: "customer" }),
      event("ticket-a", "ticket_source", "agent_replied"),
      event("ticket-a", "ticket_source", "case_closed", { toState: "resolved" }),
    ];
    expect(findCaseCloseEvent(opaque, asOf)?.type).toBe("case_closed");
    expect(findFirstResponseEvent(opaque, asOf)?.type).toBe("agent_replied");
  });

  it("only a ticket-source `resolved` pauses Resolution (eventsForPauseFold)", () => {
    for (const role of ROLES) {
      const [out] = eventsForPauseFold("resolution", [
        event("x", role, "state_changed", { toState: "resolved" }),
      ]);
      expect(out!.toState).toBe(role === "ticket_source" ? "resolved" : null);
    }
    // Other kinds fold events unchanged.
    const [same] = eventsForPauseFold("first_response", [event("x", "work_tracker", "state_changed", { toState: "resolved" })]);
    expect(same!.toState).toBe("resolved");
  });
});
