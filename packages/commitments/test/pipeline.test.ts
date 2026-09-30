import { describe, expect, it } from "vitest";
import type { BusinessCalendarVersion } from "@sla/core";
import {
  latestVersionPerPolicy,
  missingCommitmentKinds,
  resolveCommitmentCalendarVersion,
  toCaseAttributes,
  type PolicyVersionRecord,
} from "../src/pipeline";

function version(
  overrides: Partial<PolicyVersionRecord> & {
    id: string;
    policyId: string;
    version: number;
  },
): PolicyVersionRecord {
  return {
    match: {},
    targets: [],
    pauseOnStates: [],
    calendarVersionId: "cal_1",
    warnAtPercent: [50, 80, 95],
    effectiveFrom: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("latestVersionPerPolicy", () => {
  it("keeps only the highest version for each policyId", () => {
    const versions = [
      version({ id: "v1", policyId: "p1", version: 1 }),
      version({ id: "v2", policyId: "p1", version: 2 }),
      version({ id: "v3", policyId: "p2", version: 1 }),
    ];
    const active = latestVersionPerPolicy(versions);
    expect(active).toHaveLength(2);
    expect(active.find((v) => v.policyId === "p1")?.id).toBe("v2");
    expect(active.find((v) => v.policyId === "p2")?.id).toBe("v3");
  });

  it("is order-independent", () => {
    const versions = [
      version({ id: "v2", policyId: "p1", version: 2 }),
      version({ id: "v1", policyId: "p1", version: 1 }),
    ];
    expect(latestVersionPerPolicy(versions).map((v) => v.id)).toEqual(["v2"]);
  });

  it("returns an empty array for no versions", () => {
    expect(latestVersionPerPolicy([])).toEqual([]);
  });
});

describe("missingCommitmentKinds", () => {
  it("returns both kinds when a case has neither", () => {
    expect(missingCommitmentKinds([])).toEqual([
      "first_response",
      "resolution",
    ]);
  });

  it("returns only the kind not already present", () => {
    expect(missingCommitmentKinds(["first_response"])).toEqual(["resolution"]);
  });

  it("returns nothing once both kinds exist", () => {
    expect(missingCommitmentKinds(["first_response", "resolution"])).toEqual(
      [],
    );
  });
});

describe("toCaseAttributes", () => {
  it("maps null fields to undefined so packages/core's optional matching treats them as absent", () => {
    expect(
      toCaseAttributes({
        id: "case_1",
        priority: null,
        customerId: null,
        tier: null,
        openedAt: new Date(),
      }),
    ).toEqual({
      caseId: "case_1",
      attributes: {},
      priority: undefined,
      customerId: undefined,
      tier: undefined,
    });
  });

  it("passes through defined fields", () => {
    expect(
      toCaseAttributes({
        id: "case_1",
        priority: "urgent",
        customerId: "cust_1",
        tier: "gold",
        openedAt: new Date(),
      }),
    ).toEqual({
      caseId: "case_1",
      attributes: {
        priority: "urgent",
        customerId: "cust_1",
        tier: "gold",
      },
      priority: "urgent",
      customerId: "cust_1",
      tier: "gold",
    });
  });

  it("mirrors tags into attributes under `tags` only; provider aliases such as `current_tags` are the adapter's job", () => {
    expect(
      toCaseAttributes({
        id: "case_1",
        priority: null,
        customerId: null,
        tier: null,
        tags: ["d6", "vip"],
        openedAt: new Date(),
      }),
    ).toEqual({
      caseId: "case_1",
      attributes: { tags: ["d6", "vip"] },
      priority: undefined,
      customerId: undefined,
      tier: undefined,
    });
  });

  it("mirrors channel into attributes under `channel` only; provider aliases such as `via_id` are the adapter's job", () => {
    expect(
      toCaseAttributes({
        id: "case_1",
        priority: null,
        customerId: null,
        tier: null,
        channel: "chat",
        openedAt: new Date(),
      }),
    ).toEqual({
      caseId: "case_1",
      attributes: { channel: "chat" },
      priority: undefined,
      customerId: undefined,
      tier: undefined,
    });
  });

  it("passes the case's source provider through as the opaque `sourceKey` (N1.11)", () => {
    const base = { id: "case_1", priority: null, customerId: null, tier: null, openedAt: new Date() };
    expect(toCaseAttributes({ ...base, system: "some-source" }).sourceKey).toBe("some-source");
    expect(toCaseAttributes(base)).not.toHaveProperty("sourceKey");
  });

  it("merges the generic `attributes` JSON bag in as-is (Zendesk fields with no dedicated column: status, type, group_id, ...)", () => {
    expect(
      toCaseAttributes({
        id: "case_1",
        priority: null,
        customerId: null,
        tier: null,
        attributes: { status: "pending", type: "incident", group_id: 42 },
        openedAt: new Date(),
      }),
    ).toEqual({
      caseId: "case_1",
      attributes: { status: "pending", type: "incident", group_id: 42 },
      priority: undefined,
      customerId: undefined,
      tier: undefined,
    });
  });

  it("lets a canonical field (priority) win over the same key in the generic attributes bag", () => {
    expect(
      toCaseAttributes({
        id: "case_1",
        priority: "urgent",
        customerId: null,
        tier: null,
        attributes: { priority: "stale-cached-value" },
        openedAt: new Date(),
      }),
    ).toEqual({
      caseId: "case_1",
      attributes: { priority: "urgent" },
      priority: "urgent",
      customerId: undefined,
      tier: undefined,
    });
  });

  it("ignores a non-object attributes value (Json column can statically hold one, but never actually does)", () => {
    expect(
      toCaseAttributes({
        id: "case_1",
        priority: null,
        customerId: null,
        tier: null,
        attributes: "not-an-object" as unknown as Record<string, unknown>,
        openedAt: new Date(),
      }),
    ).toEqual({
      caseId: "case_1",
      attributes: {},
      priority: undefined,
      customerId: undefined,
      tier: undefined,
    });
  });
});

function calendarVersion(
  overrides: Partial<BusinessCalendarVersion> & { id: string },
): BusinessCalendarVersion {
  return {
    version: 1,
    timezone: "UTC",
    weekly: [],
    holidays: [],
    alwaysOpen: true,
    ...overrides,
  };
}

describe("resolveCommitmentCalendarVersion", () => {
  it("prefers the customer's calendar override when one is set", () => {
    const policyCalendar = calendarVersion({ id: "cal_org" });
    const customerCalendar = calendarVersion({ id: "cal_customer" });
    expect(
      resolveCommitmentCalendarVersion(policyCalendar, customerCalendar),
    ).toBe(customerCalendar);
  });

  it("falls back to the policy's calendar when the customer has no override", () => {
    const policyCalendar = calendarVersion({ id: "cal_org" });
    expect(resolveCommitmentCalendarVersion(policyCalendar, undefined)).toBe(
      policyCalendar,
    );
  });
});
