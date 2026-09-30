import { describe, expect, it } from "vitest";
import type { BusinessCalendarVersion, SLAPolicyVersion } from "@sla/core";
import type { CommitmentRecord, NormalizedEventRecord } from "../src/evaluate-pipeline";
import {
  buildOrgReplayRecords,
  compareReplays,
  parseReplay,
  serializeReplay,
  summarizeDrift,
  type CommitmentReplayRecord,
  type OrgReplayInput,
  type ReplayHeader,
} from "../src/replay";

const ASOF = "2026-01-05T12:00:00.000Z";

const calendar: BusinessCalendarVersion = {
  id: "cal_1",
  version: 1,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};

const policy: SLAPolicyVersion = {
  id: "pv_1",
  policyId: "pol_1",
  version: 1,
  match: {},
  targets: [
    { kind: "first_response", minutes: 60 },
    { kind: "resolution", minutes: 480 },
  ],
  pauseOnStates: [],
  calendarVersionId: "cal_1",
  warnAtPercent: [50, 80, 95],
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

function event(id: string, overrides: Partial<NormalizedEventRecord>): NormalizedEventRecord {
  return {
    id,
    caseId: "case_1",
    type: "case_created",
    occurredAt: new Date("2026-01-05T09:00:00Z"),
    actor: "customer",
    system: "zendesk",
    fromState: null,
    toState: null,
    sourceRawEventId: `raw_${id}`,
    sourceSequence: 0,
    ...overrides,
  };
}

function commitment(overrides: Partial<CommitmentRecord> = {}): CommitmentRecord {
  return {
    id: "cmt_1",
    caseId: "case_1",
    kind: "first_response",
    cycleKey: "single",
    policyVersionId: "pv_1",
    calendarVersionId: "cal_1",
    startedAt: new Date("2026-01-05T09:00:00Z"),
    targetMinutes: 60,
    dueAt: new Date("2026-01-05T10:00:00Z"),
    status: "breached",
    closedAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<OrgReplayInput> = {}): OrgReplayInput {
  return {
    organizationId: "org_1",
    asOf: ASOF,
    commitments: [{ ...commitment(), persisted: { status: "breached", latestEvaluation: null } }],
    cases: [
      { id: "case_1", priority: "high", customerId: null, tier: null, openedAt: new Date("2026-01-05T09:00:00Z") },
    ],
    events: [event("evt_1", {})],
    policyVersions: [policy],
    activePolicyIds: new Set(["pol_1"]),
    calendars: [calendar],
    certainLinkCountByCaseId: new Map(),
    ...overrides,
  };
}

const header: ReplayHeader = {
  type: "header",
  formatVersion: 1,
  gitSha: "abc1234",
  asOf: ASOF,
  organizationIds: ["org_1"],
};

describe("buildOrgReplayRecords", () => {
  it("is deterministic: two captures of the same data serialize byte-identically", () => {
    const first = serializeReplay(header, buildOrgReplayRecords(input()));
    const second = serializeReplay(header, buildOrgReplayRecords(input()));
    expect(second).toBe(first);
  });

  it("does not depend on the order rows are loaded in", () => {
    const second = { ...commitment({ id: "cmt_2", kind: "resolution", targetMinutes: 480 }) };
    const a = input({
      commitments: [
        { ...commitment(), persisted: { status: "breached", latestEvaluation: null } },
        { ...second, persisted: { status: "on_track", latestEvaluation: null } },
      ],
    });
    const b = input({ commitments: [...a.commitments].reverse() });
    expect(serializeReplay(header, buildOrgReplayRecords(b))).toBe(serializeReplay(header, buildOrgReplayRecords(a)));
  });

  it("emits commitment records before case records, with the compared fields populated", () => {
    const records = buildOrgReplayRecords(input());
    expect(records.map((r) => r.type)).toEqual(["commitment", "case"]);
    const [c, k] = records as [CommitmentReplayRecord, (typeof records)[1]];
    expect(c.status).toBe("breached");
    expect(c.breachedAt).toBe(c.effectiveDueAt);
    expect(c.policyVersionId).toBe("pv_1");
    expect(c.evaluationId).toEqual(expect.any(String));
    expect(k).toMatchObject({ id: "case_1", policyMatch: { first_response: "pv_1", next_reply: null, resolution: "pv_1" } });
  });

  it("excludes versions of inactive policies from the case-level policy match", () => {
    const records = buildOrgReplayRecords(input({ activePolicyIds: new Set() }));
    expect(records[1]).toMatchObject({ policyMatch: { first_response: null, next_reply: null, resolution: null } });
    // ...but a commitment frozen onto it is still evaluated.
    expect(records[0]).toMatchObject({ policyVersionId: "pv_1" });
  });
});

describe("compareReplays", () => {
  const before = buildOrgReplayRecords(input());

  it("reports no differences between identical captures", () => {
    const result = compareReplays(before, buildOrgReplayRecords(input()));
    expect(result.differences).toEqual([]);
    expect(result.unapproved).toBe(0);
    expect(result.recordsCompared).toBe(2);
  });

  it("reports a synthetic status flip as an unapproved difference", () => {
    const after = buildOrgReplayRecords(input());
    const flipped = after.map((r) => (r.type === "commitment" ? { ...r, status: "met", breachedAt: null } : r));
    const result = compareReplays(before, flipped);
    expect(result.unapproved).toBe(2);
    expect(result.differences.map((d) => [d.id, d.field, d.before, d.after])).toEqual(
      expect.arrayContaining([
        ["cmt_1", "status", "breached", "met"],
        ["cmt_1", "breachedAt", expect.any(String), null],
      ]),
    );
    expect(result.byField["commitment.status"]).toEqual({ unapproved: 1, approved: 0 });
  });

  it("does not diff the persisted (drift) fields", () => {
    const after = buildOrgReplayRecords(input()).map((r) =>
      r.type === "commitment" ? { ...r, persisted: { status: "met", breachedAt: null, hasBreachedEvaluation: false } } : r,
    );
    expect(compareReplays(before, after).differences).toEqual([]);
  });

  it("treats an allowlisted difference as approved, only for the listed fields", () => {
    const flipped = buildOrgReplayRecords(input()).map((r) =>
      r.type === "commitment" ? { ...r, status: "met", breachedAt: null } : r,
    );
    const partial = compareReplays(before, flipped, [{ type: "commitment", id: "cmt_1", fields: ["status"] }]);
    expect(partial.approved).toBe(1);
    expect(partial.unapproved).toBe(1);
    const whole = compareReplays(before, flipped, [{ type: "commitment", id: "cmt_1" }]);
    expect(whole.unapproved).toBe(0);
    expect(whole.approved).toBe(2);
  });

  it("reports a record present in only one capture", () => {
    const result = compareReplays(before, before.filter((r) => r.type !== "case"));
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({ type: "case", id: "case_1", field: "<record>", approved: false });
  });
});

describe("summarizeDrift", () => {
  it("counts recomputed status and breachedAt that disagree with what is persisted", () => {
    const [c] = buildOrgReplayRecords(input()) as [CommitmentReplayRecord];
    const clean = { ...c, persisted: { status: c.status, breachedAt: c.breachedAt, hasBreachedEvaluation: true } };
    const statusDrift = { ...c, id: "cmt_2", persisted: { status: "met", breachedAt: null, hasBreachedEvaluation: false } };
    const breachedAtDrift = {
      ...c,
      id: "cmt_3",
      persisted: { status: c.status, breachedAt: "2026-01-01T00:00:00.000Z", hasBreachedEvaluation: true },
    };
    expect(summarizeDrift([clean, statusDrift, breachedAtDrift])).toEqual({
      commitments: 3,
      statusDrift: 1,
      breachedAtDrift: 1,
    });
  });
});

describe("parseReplay", () => {
  it("round-trips a serialized capture", () => {
    const records = buildOrgReplayRecords(input());
    const parsed = parseReplay(serializeReplay(header, records));
    expect(parsed.header).toEqual(header);
    expect(parsed.records).toEqual(records);
  });

  it("rejects a file without a header line", () => {
    expect(() => parseReplay('{"type":"case","id":"x"}\n')).toThrow(/header/);
  });
});
