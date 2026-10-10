/**
 * "Current state versus history" rows of plan 09 §13: nothing is fabricated,
 * `case_closed` only at a source timestamp, `updatedAt` is never a closure
 * time, and normalizing the same rows with different fetch times is identical.
 */
import { describe, expect, it } from "vitest";
import { deriveBatch, type RawRow } from "../src/derive";
import { parseConfig, type CustomConfig } from "../src/schema";
import { RAW_PREFIX } from "../src/shared";

const base = {
  schemaVersion: 1,
  displayName: "Test Desk",
  connection: { baseUrl: "https://api.helpdesk.example.com" },
  auth: { type: "bearer" },
  tickets: { request: { method: "GET", path: "/v2/tickets" }, itemsPath: "$.data[*]", pagination: { type: "none" } },
  mapping: { id: "$.id", createdAt: "$.created_at", status: "$.state", title: "$.subject", updatedAt: "$.updated_at", closedAt: "$.resolved_at" },
  valueMaps: { status: { open: "open", pending: "pending_customer", solved: "resolved", closed: "closed" } },
  unknownStatus: "fail",
  importWindowDays: 90,
  slaMode: "full",
  creationActor: { type: "assume_customer" },
};

function configWith(patch: (c: Record<string, any>) => void = () => {}): CustomConfig {
  const draft = structuredClone(base) as Record<string, any>;
  patch(draft);
  const parsed = parseConfig(draft);
  if (!parsed.ok) throw new Error(`test config invalid: ${JSON.stringify(parsed.issues)}`);
  return parsed.config;
}

const fetched = new Date("2026-10-01T00:00:00Z");
const ticketRow = (payload: Record<string, unknown>, n = 1, at = fetched): RawRow => ({ id: `r${n}`, providerEventId: `${RAW_PREFIX.ticket}${String(payload.id)}:h${n}`, payload, fetchedAt: at });
const ticket = (o: Record<string, unknown> = {}) => ({ id: "T-1", created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-20T10:00:00Z", state: "open", subject: "Printer", ...o });
const types = (batch: ReturnType<typeof deriveBatch>) => batch.eventGroups[0]!.events.map((e) => e.type);

describe("no history is ever invented", () => {
  it("an open ticket from current state alone yields only case_created", () => {
    const batch = deriveBatch(configWith(), [ticketRow(ticket())]);
    expect(batch.failures).toEqual([]);
    expect(types(batch)).toEqual(["case_created"]);
    expect(batch.cases[0]!.closedAt).toBeNull();
    expect(batch.closedByExternalId.get("T-1")).toBe(false);
  });

  it("a status other than open does not fabricate a state_changed event", () => {
    const batch = deriveBatch(configWith(), [ticketRow(ticket({ state: "pending" }))]);
    expect(types(batch)).toEqual(["case_created"]);
  });

  it("a solved ticket WITH a source closing timestamp gets case_closed at exactly that timestamp", () => {
    const batch = deriveBatch(configWith(), [ticketRow(ticket({ state: "solved", resolved_at: "2026-09-10T12:34:56Z" }))]);
    const closed = batch.eventGroups[0]!.events.find((e) => e.type === "case_closed");
    expect(closed?.occurredAt.toISOString()).toBe("2026-09-10T12:34:56.000Z");
    expect(batch.cases[0]!.closedAt?.toISOString()).toBe("2026-09-10T12:34:56.000Z");
    expect(batch.closedByExternalId.get("T-1")).toBe(true);
  });

  it("a terminal status WITHOUT a closing timestamp is not closed, updatedAt is never substituted, and a diagnostic says why", () => {
    const batch = deriveBatch(configWith(), [ticketRow(ticket({ state: "solved", resolved_at: null }))]);
    expect(types(batch)).toEqual(["case_created"]);
    expect(batch.cases[0]!.closedAt).toBeNull();
    expect(JSON.stringify(batch.eventGroups[0]!.events)).not.toContain("2026-09-20"); // the updated_at value
    expect(batch.diagnostics).toContainEqual({ id: "T-1", code: "terminal_status_without_closure_timestamp" });

    const missing = deriveBatch(configWith(), [ticketRow(ticket({ state: "closed" }))]); // the field is absent altogether
    expect(missing.cases[0]!.closedAt).toBeNull();
    expect(missing.diagnostics).toContainEqual({ id: "T-1", code: "terminal_status_without_closure_timestamp" });
  });

  it("a closing time earlier than the opening time is refused rather than stored", () => {
    const batch = deriveBatch(configWith(), [ticketRow(ticket({ state: "solved", resolved_at: "2026-08-01T00:00:00Z" }))]);
    expect(batch.cases).toEqual([]);
    expect(batch.failures[0]).toMatchObject({ id: "T-1", code: "invalid_date" });
  });
});

describe("real history is imported at its timestamps", () => {
  const withHistory = () =>
    configWith((c) => {
      c.statusHistory = {
        request: { method: "GET", path: "/v2/tickets/{{ticket.id}}/history" },
        itemsPath: "$.entries[*]",
        pagination: { type: "none" },
        mapping: { id: "$.id", changedAt: "$.at", toStatus: "$.to", fromStatus: "$.from" },
      };
    });
  const history = (id: string, at: string, from: string | null, to: string, n: number, ticketId = "T-1"): RawRow => ({
    id: `h${n}`,
    providerEventId: `${RAW_PREFIX.history}${ticketId}:${id}:x`,
    payload: { t: ticketId, i: { id, at, from, to } },
    fetchedAt: fetched,
  });

  it("emits state_changed / case_closed at the source's change times, in order, with the right states", () => {
    const rows = [
      ticketRow(ticket({ state: "solved" })),
      history("e2", "2026-09-05T09:00:00Z", "pending", "solved", 2),
      history("e1", "2026-09-02T09:00:00Z", "open", "pending", 1),
    ];
    const batch = deriveBatch(withHistory(), rows);
    expect(batch.failures).toEqual([]);
    const events = batch.eventGroups[0]!.events;
    expect(events.map((e) => [e.type, e.occurredAt.toISOString()])).toEqual([
      ["case_created", "2026-09-01T10:00:00.000Z"],
      ["state_changed", "2026-09-02T09:00:00.000Z"],
      ["case_closed", "2026-09-05T09:00:00.000Z"],
    ]);
    expect(batch.cases[0]!.closedAt?.toISOString()).toBe("2026-09-05T09:00:00.000Z");
  });

  it("a history that disagrees with the current status is reported, not silently reconciled", () => {
    const rows = [ticketRow(ticket({ state: "solved" })), history("e1", "2026-09-02T09:00:00Z", "open", "pending", 1)];
    const batch = deriveBatch(withHistory(), rows);
    expect(batch.diagnostics).toContainEqual({ id: "T-1", code: "history_status_mismatch" });
    expect(batch.cases[0]!.closedAt).toBeNull();
  });
});

describe("determinism: the same rows normalize identically whenever they were fetched", () => {
  const rows = (at: Date): RawRow[] => [
    ticketRow(ticket({ id: "T-1", state: "solved", resolved_at: "2026-09-10T00:00:00Z" }), 1, at),
    ticketRow(ticket({ id: "T-2" }), 2, at),
    ticketRow(ticket({ id: "T-3", state: "pending" }), 3, at),
  ];
  const strip = (b: ReturnType<typeof deriveBatch>) => JSON.stringify({ ...b, closedByExternalId: [...b.closedByExternalId] });

  it("is identical for different fetch times", () => {
    const a = deriveBatch(configWith(), rows(new Date("2026-10-01T00:00:00Z")));
    const b = deriveBatch(configWith(), rows(new Date("2026-12-31T23:59:59Z")));
    expect(strip(a)).toBe(strip(b));
  });

  it("is identical for any input order and for repeated runs", () => {
    const forward = rows(fetched);
    const reversed = [...forward].reverse();
    expect(strip(deriveBatch(configWith(), forward))).toBe(strip(deriveBatch(configWith(), reversed)));
    expect(strip(deriveBatch(configWith(), forward))).toBe(strip(deriveBatch(configWith(), forward)));
  });

  it("a ticket seen in several snapshots derives one case from the latest snapshot, counted once in B", () => {
    const early = ticketRow(ticket({ subject: "old title" }), 1, new Date("2026-10-01T00:00:00Z"));
    const late = ticketRow(ticket({ subject: "new title" }), 2, new Date("2026-10-02T00:00:00Z"));
    const batch = deriveBatch(configWith(), [late, early]);
    expect(batch.attempted).toBe(1);
    expect(batch.cases).toHaveLength(1);
    expect(batch.cases[0]!.subject).toBe("new title");
  });
});

describe("status mapping: unknown status fails unless the explicit open fallback is set", () => {
  it("fails with unknown_status and does not echo the value", () => {
    const batch = deriveBatch(configWith(), [ticketRow(ticket({ state: "weird-status-xyz" }))]);
    expect(batch.cases).toEqual([]);
    expect(batch.failures[0]).toMatchObject({ id: "T-1", code: "unknown_status" });
    expect(JSON.stringify(batch.failures)).not.toContain("weird-status-xyz");
    expect(batch.attempted).toBe(1);
  });

  it("treats it as open when unknownStatus is 'open'", () => {
    const batch = deriveBatch(configWith((c) => (c.unknownStatus = "open")), [ticketRow(ticket({ state: "weird-status-xyz" }))]);
    expect(batch.failures).toEqual([]);
    expect(types(batch)).toEqual(["case_created"]);
  });

  it("a prototype-named status is not found through the prototype chain", () => {
    for (const state of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const batch = deriveBatch(configWith(), [ticketRow(ticket({ state }))]);
      expect(batch.failures[0]?.code, state).toBe("unknown_status");
    }
  });
});

describe("priority, duplicates and bad records", () => {
  it("an unknown priority is null with a diagnostic, not a failure", () => {
    const config = configWith((c) => {
      c.mapping.priority = "$.priority";
      c.valueMaps.priority = { p1: "urgent" };
    });
    const known = deriveBatch(config, [ticketRow(ticket({ priority: "p1" }))]);
    expect(known.cases[0]!.priority).toBe("urgent");
    const unknown = deriveBatch(config, [ticketRow(ticket({ priority: "p9" }))]);
    expect(unknown.failures).toEqual([]);
    expect(unknown.cases[0]!.priority).toBeNull();
    expect(unknown.diagnostics).toContainEqual({ id: "T-1", code: "unknown_priority" });
  });

  it("a record without an id is skipped (never a failure of another ticket), and failures do not abort the rest", () => {
    const rows = [ticketRow({ created_at: "2026-09-01T10:00:00Z", state: "open" }, 1), ticketRow(ticket({ id: "T-2", state: "bogus" }), 2), ticketRow(ticket({ id: "T-3" }), 3)];
    const batch = deriveBatch(configWith(), rows);
    expect(batch.cases.map((c) => c.externalId)).toEqual(["T-3"]);
    expect(batch.failures.map((f) => f.id)).toEqual(["T-2"]);
    expect(batch.attempted).toBe(2);
  });

  it("a source deletion signal removes the case from the live set and a restored snapshot elsewhere is not resurrected", () => {
    const rows: RawRow[] = [ticketRow(ticket()), { id: "d1", providerEventId: `${RAW_PREFIX.deleted}T-1:x`, payload: { t: "T-1" }, fetchedAt: fetched }];
    const batch = deriveBatch(configWith(), rows);
    expect(batch.deletedCaseExternalIds).toEqual(["T-1"]);
    expect(batch.cases).toEqual([]);
    expect(batch.caseExternalIds).toEqual([]);
  });

  it("absence from a list never deletes: a ticket that is simply not in the rows produces no deletion", () => {
    const batch = deriveBatch(configWith(), [ticketRow(ticket({ id: "T-2" }), 2)]);
    expect(batch.deletedCaseExternalIds).toEqual([]);
  });
});

describe("deletion signals are permanent in V1 (the premise of OD-01 / plan 09 U2)", () => {
  const marker = (id: string, at: string): RawRow => ({ id: `d-${id}`, providerEventId: `${RAW_PREFIX.deleted}${id}:x`, payload: { t: id }, fetchedAt: new Date(at) });

  it("a ticket restored at the source AFTER a stored deletion marker stays deleted: a newer snapshot does not clear it", () => {
    const rows: RawRow[] = [
      ticketRow(ticket(), 1, new Date("2026-10-01T00:00:00Z")),
      marker("T-1", "2026-10-02T00:00:00Z"),
      ticketRow(ticket({ subject: "restored" }), 2, new Date("2026-10-03T00:00:00Z")), // the source brought it back
    ];
    const batch = deriveBatch(configWith(), rows);
    expect(batch.deletedCaseExternalIds).toEqual(["T-1"]);
    expect(batch.cases).toEqual([]);
  });

  it("a status/flag based deletion IS reversible at the source: a newer snapshot without the deleted status derives a live case", () => {
    const withStatus = configWith((c) => {
      c.valueMaps.status.gone = "closed";
      c.deletion = { statusValues: ["gone"] };
    });
    const gone = ticketRow(ticket({ state: "gone" }), 1, new Date("2026-10-01T00:00:00Z"));
    expect(deriveBatch(withStatus, [gone]).deletedCaseExternalIds).toEqual(["T-1"]);
    const restored = ticketRow(ticket({ state: "open" }), 2, new Date("2026-10-03T00:00:00Z"));
    const batch = deriveBatch(withStatus, [gone, restored]);
    expect(batch.deletedCaseExternalIds).toEqual([]);
    expect(batch.cases.map((c) => c.externalId)).toEqual(["T-1"]);
  });
});

