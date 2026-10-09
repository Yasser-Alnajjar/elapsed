import { describe, expect, it } from "vitest";
import { caseFieldsChanged, sameJson, type CaseFacts, type StoredCaseFields } from "../src";

const stored = (overrides: Partial<StoredCaseFields> = {}): StoredCaseFields => ({
  customerId: "c1",
  subject: "Cannot log in",
  assigneeName: "Ada",
  priority: "high",
  channel: "web",
  closedAt: null,
  requesterName: "Ahmed",
  tier: null,
  tags: ["vip", "bug"],
  attributes: { status: "open" },
  ...overrides,
});

const facts = (overrides: Partial<CaseFacts> = {}): CaseFacts => ({
  externalId: "1",
  subject: "Cannot log in",
  assigneeName: "Ada",
  priority: "high",
  channel: "web",
  openedAt: new Date("2026-09-01T09:00:00Z"),
  closedAt: null,
  customer: null,
  requesterName: "Ahmed",
  tier: null,
  tags: ["vip", "bug"],
  attributes: { status: "open" },
  ...overrides,
});

describe("caseFieldsChanged", () => {
  it("is false for identical values, including dates compared by instant and attributes by structure", () => {
    expect(caseFieldsChanged(stored(), facts(), "c1")).toBe(false);
    expect(caseFieldsChanged(stored({ closedAt: new Date("2026-09-02T00:00:00Z") }), facts({ closedAt: new Date("2026-09-02T00:00:00Z") }), "c1")).toBe(false);
    expect(caseFieldsChanged(stored({ attributes: { b: 1, a: { y: 2, x: 1 } } }), facts({ attributes: { a: { x: 1, y: 2 }, b: 1 } }), "c1")).toBe(false);
  });

  it.each([
    ["assignee", facts({ assigneeName: "Grace" })],
    ["priority", facts({ priority: "low" })],
    ["priority cleared", facts({ priority: null })],
    ["subject", facts({ subject: "Other" })],
    ["channel", facts({ channel: "chat" })],
    ["closing time", facts({ closedAt: new Date("2026-09-02T00:00:00Z") })],
    ["tag order", facts({ tags: ["bug", "vip"] })],
    ["tags", facts({ tags: ["vip"] })],
    ["attributes", facts({ attributes: { status: "solved" } })],
    ["attributes cleared", facts({ attributes: null })],
    ["requester", facts({ requesterName: "Someone" })],
    ["tier", facts({ tier: "gold" })],
  ])("is true for a changed %s", (_name, next) => {
    expect(caseFieldsChanged(stored(), next, "c1")).toBe(true);
  });

  it("is true when the resolved customer differs", () => {
    expect(caseFieldsChanged(stored(), facts(), "c2")).toBe(true);
    expect(caseFieldsChanged(stored(), facts(), null)).toBe(true);
  });

  it("never treats an omitted optional field as a change", () => {
    const { requesterName: _r, tier: _t, tags: _g, attributes: _a, ...omitted } = facts();
    expect(caseFieldsChanged(stored({ requesterName: "Other", tier: "gold", tags: ["x"], attributes: { z: 1 } }), omitted, "c1")).toBe(false);
  });
});

describe("sameJson", () => {
  it("ignores key order and treats missing as null", () => {
    expect(sameJson({ a: 1, b: [{ d: 1, c: 2 }] }, { b: [{ c: 2, d: 1 }], a: 1 })).toBe(true);
    expect(sameJson(null, undefined)).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
  });
});
