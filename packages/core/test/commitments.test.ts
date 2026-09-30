import { describe, expect, it } from "vitest";
import {
  createCommitment,
  matchPolicyVersion,
  resolveCommitmentPolicyChange,
} from "../src/commitments.js";
import { SINGLE_CYCLE_KEY } from "../src/types";
import type {
  BusinessCalendarVersion,
  CaseAttributes,
  SLAPolicyVersion,
} from "../src/types";

const calendar: BusinessCalendarVersion = {
  id: "cal-24-7",
  version: 1,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};

const genericPolicy: SLAPolicyVersion = {
  id: "policy-generic",
  policyId: "policy",
  version: 1,
  match: {},
  targets: [{ kind: "resolution", minutes: 480 }],
  pauseOnStates: [],
  calendarVersionId: calendar.id,
  warnAtPercent: [80],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

const p1Policy: SLAPolicyVersion = {
  id: "policy-p1",
  policyId: "policy",
  version: 2,
  match: { priority: ["P1"] },
  targets: [{ kind: "resolution", minutes: 240 }],
  pauseOnStates: [],
  calendarVersionId: calendar.id,
  warnAtPercent: [80],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

const p1Tier1Policy: SLAPolicyVersion = {
  id: "policy-p1-tier1",
  policyId: "policy",
  version: 3,
  match: { priority: ["P1"], tier: ["tier1"] },
  targets: [{ kind: "resolution", minutes: 120 }],
  pauseOnStates: [],
  calendarVersionId: calendar.id,
  warnAtPercent: [80],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

const otherPolicy: SLAPolicyVersion = {
  id: "policy-other-v1",
  policyId: "policy-other",
  version: 1,
  match: { priority: ["P1"] },
  targets: [{ kind: "resolution", minutes: 90 }],
  pauseOnStates: [],
  calendarVersionId: calendar.id,
  warnAtPercent: [80],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

const d6TagPolicy: SLAPolicyVersion = {
  id: "policy-d6-tag",
  policyId: "policy-d6-tag",
  version: 1,
  match: {
    conditions: {
      all: [
        {
          field: "priority",
          operator: "is",
          value: "urgent",
        },
        {
          field: "tags",
          operator: "contains",
          value: "d6-test",
        },
      ],
    },
  },
  targets: [{ kind: "resolution", minutes: 10 }],
  pauseOnStates: [],
  calendarVersionId: calendar.id,
  warnAtPercent: [80],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

const d6GroupPolicy: SLAPolicyVersion = {
  id: "policy-d6-group",
  policyId: "policy-d6-group",
  version: 1,
  match: {
    conditions: {
      all: [
        {
          field: "group_id",
          operator: "is",
          value: 42,
        },
      ],
    },
  },
  targets: [{ kind: "resolution", minutes: 20 }],
  pauseOnStates: [],
  calendarVersionId: calendar.id,
  warnAtPercent: [80],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

describe("matchPolicyVersion", () => {
  it("matches the most specific policy first", () => {
    const caseAttributes: CaseAttributes = {
      caseId: "case-1",
      attributes: {},
      priority: "P1",
      tier: "tier1",
    };

    const match = matchPolicyVersion(caseAttributes, [
      genericPolicy,
      p1Policy,
      p1Tier1Policy,
    ]);

    expect(match?.id).toBe("policy-p1-tier1");
  });

  it("falls back to a less specific policy when the most specific doesn't match", () => {
    const caseAttributes: CaseAttributes = {
      caseId: "case-1",
      attributes: {},
      priority: "P1",
      tier: "tier2",
    };

    const match = matchPolicyVersion(caseAttributes, [
      genericPolicy,
      p1Policy,
      p1Tier1Policy,
    ]);

    expect(match?.id).toBe("policy-p1");
  });

  it("returns null when nothing matches", () => {
    const caseAttributes: CaseAttributes = {
      caseId: "case-1",
      attributes: {},
      priority: "P3",
    };

    const match = matchPolicyVersion(caseAttributes, [p1Policy, p1Tier1Policy]);

    expect(match).toBeNull();
  });

  describe("generic conditions", () => {
    it("matches an arbitrary condition against generic case attributes", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {
          tags: ["d6-test", "customer-visible"],
        },
        priority: "urgent",
      };

      const match = matchPolicyVersion(caseAttributes, [d6TagPolicy]);

      expect(match?.id).toBe("policy-d6-tag");
    });

    it("does not match when an all condition is missing", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {
          tags: ["customer-visible"],
        },
        priority: "urgent",
      };

      const match = matchPolicyVersion(caseAttributes, [d6TagPolicy]);

      expect(match).toBeNull();
    });

    it("does not broaden a policy when an arbitrary condition is missing", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-85",
        attributes: {
          tags: [],
        },
        priority: "urgent",
      };

      const match = matchPolicyVersion(caseAttributes, [d6TagPolicy]);

      expect(match).toBeNull();
    });

    it("supports arbitrary fields without adding dedicated CaseAttributes properties", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {
          group_id: 42,
        },
      };

      const match = matchPolicyVersion(caseAttributes, [d6GroupPolicy]);

      expect(match?.id).toBe("policy-d6-group");
    });

    it("fails closed for an unknown operator", () => {
      const policy: SLAPolicyVersion = {
        ...d6TagPolicy,
        id: "policy-unknown-operator",
        match: {
          conditions: {
            all: [
              {
                field: "tags",
                operator: "future_operator_that_is_not_supported",
                value: "d6-test",
              },
            ],
          },
        },
      };

      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {
          tags: ["d6-test"],
        },
      };

      expect(matchPolicyVersion(caseAttributes, [policy])).toBeNull();
    });

    it("requires every condition in all to match", () => {
      const policy: SLAPolicyVersion = {
        ...d6TagPolicy,
        id: "policy-all",
        match: {
          conditions: {
            all: [
              {
                field: "priority",
                operator: "is",
                value: "urgent",
              },
              {
                field: "tags",
                operator: "contains",
                value: "d6-test",
              },
            ],
          },
        },
      };

      const matchingCase: CaseAttributes = {
        caseId: "case-1",
        attributes: {
          tags: ["d6-test"],
        },
        priority: "urgent",
      };

      const nonMatchingCase: CaseAttributes = {
        caseId: "case-2",
        attributes: {
          tags: ["d6-test"],
        },
        priority: "normal",
      };

      expect(matchPolicyVersion(matchingCase, [policy])?.id).toBe("policy-all");
      expect(matchPolicyVersion(nonMatchingCase, [policy])).toBeNull();
    });

    it("requires at least one condition in any to match", () => {
      const policy: SLAPolicyVersion = {
        ...d6TagPolicy,
        id: "policy-any",
        match: {
          conditions: {
            any: [
              {
                field: "tags",
                operator: "contains",
                value: "d6-test",
              },
              {
                field: "type",
                operator: "is",
                value: "incident",
              },
            ],
          },
        },
      };

      const tagCase: CaseAttributes = {
        caseId: "case-1",
        attributes: {
          tags: ["d6-test"],
        },
      };

      const typeCase: CaseAttributes = {
        caseId: "case-2",
        attributes: {
          type: "incident",
        },
      };

      const nonMatchingCase: CaseAttributes = {
        caseId: "case-3",
        attributes: {
          type: "question",
          tags: ["customer-visible"],
        },
      };

      expect(matchPolicyVersion(tagCase, [policy])?.id).toBe("policy-any");
      expect(matchPolicyVersion(typeCase, [policy])?.id).toBe("policy-any");
      expect(matchPolicyVersion(nonMatchingCase, [policy])).toBeNull();
    });

    it("does not match a Zendesk high-priority policy when its required tag is absent", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-85",
        attributes: {
          tags: [],
        },
        priority: "urgent",
      };

      const match = matchPolicyVersion(caseAttributes, [d6TagPolicy]);

      expect(match).toBeNull();
    });

    it("matches a Zendesk high-priority policy when its required tag is present", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-85",
        attributes: {
          tags: ["d6-test"],
        },
        priority: "urgent",
      };

      const match = matchPolicyVersion(caseAttributes, [d6TagPolicy]);

      expect(match?.id).toBe("policy-d6-tag");
    });
  });

  describe("full Zendesk SLA condition field coverage", () => {
    const orgPolicy: SLAPolicyVersion = {
      ...genericPolicy,
      id: "policy-org",
      match: { customerIds: ["cust-acme"] },
    };

    it("matches organization via match.customerIds, not a generic condition", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {},
        customerId: "cust-acme",
      };

      expect(matchPolicyVersion(caseAttributes, [orgPolicy])?.id).toBe(
        "policy-org",
      );
      expect(
        matchPolicyVersion(
          { caseId: "case-2", attributes: {}, customerId: "cust-other" },
          [orgPolicy],
        ),
      ).toBeNull();
    });

    it("matches current_tags with a space-delimited 'includes' value as any-of, like Zendesk's tag condition", () => {
      const policy: SLAPolicyVersion = {
        ...genericPolicy,
        id: "policy-current-tags",
        match: {
          conditions: {
            all: [
              { field: "current_tags", operator: "includes", value: "vip escalated" },
            ],
          },
        },
      };

      expect(
        matchPolicyVersion(
          { caseId: "case-1", attributes: { current_tags: ["escalated"] } },
          [policy],
        )?.id,
      ).toBe("policy-current-tags");

      expect(
        matchPolicyVersion(
          { caseId: "case-2", attributes: { current_tags: ["billing"] } },
          [policy],
        ),
      ).toBeNull();
    });

    it("matches not_includes on current_tags (none of the listed tags present)", () => {
      const policy: SLAPolicyVersion = {
        ...genericPolicy,
        id: "policy-not-includes",
        match: {
          conditions: {
            all: [
              { field: "current_tags", operator: "not_includes", value: "vip escalated" },
            ],
          },
        },
      };

      expect(
        matchPolicyVersion(
          { caseId: "case-1", attributes: { current_tags: ["billing"] } },
          [policy],
        )?.id,
      ).toBe("policy-not-includes");

      expect(
        matchPolicyVersion(
          { caseId: "case-2", attributes: { current_tags: ["escalated"] } },
          [policy],
        ),
      ).toBeNull();
    });

    it("matches status, type, group_id, assignee_id, requester_id, channel, and custom fields generically", () => {
      const policy: SLAPolicyVersion = {
        ...genericPolicy,
        id: "policy-many-fields",
        match: {
          conditions: {
            all: [
              { field: "status", operator: "is", value: "pending" },
              { field: "type", operator: "is", value: "incident" },
              { field: "group_id", operator: "is", value: 42 },
              { field: "assignee_id", operator: "is", value: 7 },
              { field: "requester_id", operator: "is", value: 99 },
              { field: "channel", operator: "is", value: "chat" },
              { field: "custom_fields_360000123", operator: "is", value: "gold" },
            ],
          },
        },
      };

      const matchingCase: CaseAttributes = {
        caseId: "case-1",
        attributes: {
          status: "pending",
          type: "incident",
          group_id: 42,
          assignee_id: 7,
          requester_id: 99,
          channel: "chat",
          custom_fields_360000123: "gold",
        },
      };

      expect(matchPolicyVersion(matchingCase, [policy])?.id).toBe(
        "policy-many-fields",
      );

      const missingOneField: CaseAttributes = {
        ...matchingCase,
        caseId: "case-2",
        attributes: { ...matchingCase.attributes, channel: "email" },
      };
      expect(matchPolicyVersion(missingOneField, [policy])).toBeNull();
    });

    it("matches priority ordinal comparisons (less_than/greater_than)", () => {
      const atLeastHigh: SLAPolicyVersion = {
        ...genericPolicy,
        id: "policy-priority-gte-high",
        match: {
          conditions: {
            all: [{ field: "priority", operator: "greater_than_equal", value: "high" }],
          },
        },
      };

      expect(
        matchPolicyVersion(
          { caseId: "case-1", attributes: {}, priority: "urgent" },
          [atLeastHigh],
        )?.id,
      ).toBe("policy-priority-gte-high");
      expect(
        matchPolicyVersion(
          { caseId: "case-2", attributes: {}, priority: "high" },
          [atLeastHigh],
        )?.id,
      ).toBe("policy-priority-gte-high");
      expect(
        matchPolicyVersion(
          { caseId: "case-3", attributes: {}, priority: "normal" },
          [atLeastHigh],
        ),
      ).toBeNull();
    });

    it("fails safe for an ordinal comparison it cannot evaluate (unrecognized priority string)", () => {
      const policy: SLAPolicyVersion = {
        ...genericPolicy,
        id: "policy-bad-ordinal",
        match: {
          conditions: {
            all: [{ field: "priority", operator: "less_than", value: "high" }],
          },
        },
      };

      expect(
        matchPolicyVersion(
          { caseId: "case-1", attributes: {}, priority: "not-a-priority" },
          [policy],
        ),
      ).toBeNull();
    });

    it("matches exact_created_at with less_than/greater_than as a date comparison", () => {
      const before2026: SLAPolicyVersion = {
        ...genericPolicy,
        id: "policy-created-before",
        match: {
          conditions: {
            all: [
              {
                field: "exact_created_at",
                operator: "less_than",
                value: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        },
      };

      expect(
        matchPolicyVersion(
          {
            caseId: "case-1",
            attributes: { exact_created_at: "2025-06-01T00:00:00.000Z" },
          },
          [before2026],
        )?.id,
      ).toBe("policy-created-before");
      expect(
        matchPolicyVersion(
          {
            caseId: "case-2",
            attributes: { exact_created_at: "2026-06-01T00:00:00.000Z" },
          },
          [before2026],
        ),
      ).toBeNull();
    });

    it("matches `present`/`not_present` on a custom field, including when the field is entirely missing", () => {
      const requiresCustomField: SLAPolicyVersion = {
        ...genericPolicy,
        id: "policy-present",
        match: {
          conditions: {
            all: [{ field: "custom_fields_1", operator: "present", value: null }],
          },
        },
      };

      expect(
        matchPolicyVersion(
          { caseId: "case-1", attributes: { custom_fields_1: "value" } },
          [requiresCustomField],
        )?.id,
      ).toBe("policy-present");
      expect(
        matchPolicyVersion({ caseId: "case-2", attributes: {} }, [
          requiresCustomField,
        ]),
      ).toBeNull();

      const requiresAbsence: SLAPolicyVersion = {
        ...genericPolicy,
        id: "policy-not-present",
        match: {
          conditions: {
            all: [{ field: "custom_fields_1", operator: "not_present", value: null }],
          },
        },
      };

      expect(
        matchPolicyVersion({ caseId: "case-3", attributes: {} }, [
          requiresAbsence,
        ])?.id,
      ).toBe("policy-not-present");
      expect(
        matchPolicyVersion(
          { caseId: "case-4", attributes: { custom_fields_1: "value" } },
          [requiresAbsence],
        ),
      ).toBeNull();
    });

    it("picks the most specific of several matching policies when none carry a Zendesk position", () => {
      const catchAll: SLAPolicyVersion = {
        ...genericPolicy,
        id: "catch-all",
      };
      const tagSpecific: SLAPolicyVersion = {
        ...genericPolicy,
        id: "tag-specific",
        match: {
          conditions: {
            all: [{ field: "tags", operator: "contains", value: "vip" }],
          },
        },
      };
      const orgAndTag: SLAPolicyVersion = {
        ...genericPolicy,
        id: "org-and-tag",
        match: {
          customerIds: ["cust-acme"],
          conditions: {
            all: [{ field: "tags", operator: "contains", value: "vip" }],
          },
        },
      };

      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: { tags: ["vip"] },
        customerId: "cust-acme",
      };

      // Specificity only counts `match.priority`/`customerIds`/`tier`
      // (see `specificity`) — a generic `conditions` match is a tiebreaker
      // input Zendesk's own `position` decides in practice (D6); absent a
      // position, both tag-only and org+tag policies tie on `conditions`
      // alone, so `orgAndTag`'s extra `customerIds` breaks the tie.
      expect(
        matchPolicyVersion(caseAttributes, [catchAll, tagSpecific, orgAndTag])
          ?.id,
      ).toBe("org-and-tag");
    });
  });

  describe("D6: imported Zendesk position outranks specificity", () => {
    it("prefers the lower position even when it's less specific", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {},
        priority: "P1",
        tier: "tier1",
      };

      const lowPositionGeneric: SLAPolicyVersion = {
        ...genericPolicy,
        id: "generic-pos-1",
        policyPosition: 1,
      };

      const higherPositionSpecific: SLAPolicyVersion = {
        ...p1Tier1Policy,
        id: "specific-pos-5",
        policyPosition: 5,
      };

      const match = matchPolicyVersion(caseAttributes, [
        higherPositionSpecific,
        lowPositionGeneric,
      ]);

      expect(match?.id).toBe("generic-pos-1");
    });

    it("a positioned version always outranks an unpositioned one, regardless of specificity", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {},
        priority: "P1",
        tier: "tier1",
      };

      const positioned: SLAPolicyVersion = {
        ...genericPolicy,
        id: "positioned",
        policyPosition: 3,
      };

      const unpositionedSpecific: SLAPolicyVersion = {
        ...p1Tier1Policy,
        id: "unpositioned",
        policyPosition: null,
      };

      expect(
        matchPolicyVersion(caseAttributes, [unpositionedSpecific, positioned])
          ?.id,
      ).toBe("positioned");

      expect(
        matchPolicyVersion(caseAttributes, [positioned, unpositionedSpecific])
          ?.id,
      ).toBe("positioned");
    });

    it("falls back to specificity when positions tie (fanned-out priority groups of one Zendesk policy)", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {},
        priority: "P1",
        tier: "tier1",
      };

      const genericSamePos: SLAPolicyVersion = {
        ...genericPolicy,
        id: "same-pos-generic",
        policyPosition: 2,
      };

      const specificSamePos: SLAPolicyVersion = {
        ...p1Tier1Policy,
        id: "same-pos-specific",
        policyPosition: 2,
      };

      expect(
        matchPolicyVersion(caseAttributes, [genericSamePos, specificSamePos])
          ?.id,
      ).toBe("same-pos-specific");
    });

    it("falls back to specificity when neither candidate has a position (manual policies, or pre-D6 imports)", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {},
        priority: "P1",
        tier: "tier1",
      };

      const match = matchPolicyVersion(caseAttributes, [
        genericPolicy,
        p1Policy,
        p1Tier1Policy,
      ]);

      expect(match?.id).toBe("policy-p1-tier1");
    });
  });

  describe("D12: imported policies always match before native ones", () => {
    it("prefers an imported (or unmarked, treated as imported) candidate over a more specific native one", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {},
        priority: "P1",
        tier: "tier1",
      };

      const importedGeneric: SLAPolicyVersion = {
        ...genericPolicy,
        id: "imported-generic",
        policySource: "imported",
      };

      const nativeSpecific: SLAPolicyVersion = {
        ...p1Tier1Policy,
        id: "native-specific",
        policySource: "native",
      };

      expect(
        matchPolicyVersion(caseAttributes, [nativeSpecific, importedGeneric])
          ?.id,
      ).toBe("imported-generic");
      expect(
        matchPolicyVersion(caseAttributes, [importedGeneric, nativeSpecific])
          ?.id,
      ).toBe("imported-generic");
    });

    it("a native candidate with a higher position never outranks an imported one without a position", () => {
      // Position only matters within the imported bucket (D6); it must never
      // let a native policy jump ahead of an imported one.
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {},
        priority: "P1",
        tier: "tier1",
      };

      const importedNoPosition: SLAPolicyVersion = {
        ...genericPolicy,
        id: "imported-no-position",
        policySource: "imported",
        policyPosition: null,
      };

      const nativeWithPosition: SLAPolicyVersion = {
        ...p1Tier1Policy,
        id: "native-with-position",
        policySource: "native",
        policyPosition: 1,
      };

      expect(
        matchPolicyVersion(caseAttributes, [
          nativeWithPosition,
          importedNoPosition,
        ])?.id,
      ).toBe("imported-no-position");
    });

    it("falls back to specificity/version/id among native candidates when no imported policy matches", () => {
      const caseAttributes: CaseAttributes = {
        caseId: "case-1",
        attributes: {},
        priority: "P1",
        tier: "tier1",
      };

      const nativeGeneric: SLAPolicyVersion = {
        ...genericPolicy,
        id: "native-generic",
        policySource: "native",
      };

      const nativeSpecific: SLAPolicyVersion = {
        ...p1Tier1Policy,
        id: "native-specific",
        policySource: "native",
      };

      expect(
        matchPolicyVersion(caseAttributes, [nativeGeneric, nativeSpecific])
          ?.id,
      ).toBe("native-specific");
    });
  });

  describe("N1.11: imported policies are scoped to their source", () => {
    const importedFromA: SLAPolicyVersion = {
      ...genericPolicy,
      id: "imported-from-a",
      policySource: "imported",
      sourceKey: "source-a",
    };
    const nativeGeneric: SLAPolicyVersion = {
      ...genericPolicy,
      id: "native-generic",
      policySource: "native",
    };

    it("prices a case of the same source", () => {
      expect(
        matchPolicyVersion(
          { caseId: "c", attributes: {}, sourceKey: "source-a" },
          [importedFromA],
        )?.id,
      ).toBe("imported-from-a");
    });

    it("is not a candidate for a case of another source, so that case falls through to a native policy", () => {
      const other: CaseAttributes = {
        caseId: "c",
        attributes: {},
        sourceKey: "source-b",
      };
      expect(matchPolicyVersion(other, [importedFromA])).toBeNull();
      expect(
        matchPolicyVersion(other, [importedFromA, nativeGeneric])?.id,
      ).toBe("native-generic");
    });

    it("is not a candidate for a case whose source is unknown", () => {
      expect(
        matchPolicyVersion({ caseId: "c", attributes: {} }, [importedFromA]),
      ).toBeNull();
    });

    it("a native policy is a candidate for every source, even one that carries a key", () => {
      const keyedNative: SLAPolicyVersion = {
        ...nativeGeneric,
        sourceKey: "source-a",
      };
      expect(
        matchPolicyVersion(
          { caseId: "c", attributes: {}, sourceKey: "source-b" },
          [keyedNative],
        )?.id,
      ).toBe("native-generic");
    });

    it("an imported policy without a key stays unscoped (rows that predate scoping keep matching)", () => {
      const unscoped: SLAPolicyVersion = {
        ...genericPolicy,
        id: "unscoped",
        policySource: "imported",
        sourceKey: null,
      };
      for (const sourceKey of ["source-a", "source-b", undefined]) {
        expect(
          matchPolicyVersion({ caseId: "c", attributes: {}, sourceKey }, [
            unscoped,
          ])?.id,
        ).toBe("unscoped");
      }
    });

    it("scoping applies before ranking: a case takes its own source's policy even when another source's has a better position", () => {
      const betterPositionOtherSource: SLAPolicyVersion = {
        ...genericPolicy,
        id: "other-source-first",
        policySource: "imported",
        sourceKey: "source-b",
        policyPosition: 1,
      };
      const ownSource: SLAPolicyVersion = {
        ...importedFromA,
        policyPosition: 9,
      };
      expect(
        matchPolicyVersion(
          { caseId: "c", attributes: {}, sourceKey: "source-a" },
          [betterPositionOtherSource, ownSource],
        )?.id,
      ).toBe("imported-from-a");
    });
  });
});

describe("createCommitment", () => {
  it("freezes the policy and calendar version ids onto the commitment", () => {
    const commitment = createCommitment(
      "case-1",
      "resolution",
      "2026-09-07T09:00:00.000Z",
      p1Policy,
      calendar,
    );

    expect(commitment.policyVersionId).toBe(p1Policy.id);
    expect(commitment.calendarVersionId).toBe(calendar.id);
    expect(commitment.targetMinutes).toBe(240);
    expect(commitment.dueAt).toBe("2026-09-07T13:00:00.000Z");
    expect(commitment.status).toBe("on_track");
  });

  it("keys a single-cycle kind as the one cycle of its kind on the case", () => {
    const commitment = createCommitment(
      "case-1",
      "resolution",
      "2026-09-07T09:00:00.000Z",
      p1Policy,
      calendar,
    );

    expect(commitment.cycleKey).toBe(SINGLE_CYCLE_KEY);
  });

  it("keeps the given cycle key for a next reply cycle and starts at that cycle", () => {
    const policy: SLAPolicyVersion = {
      ...p1Policy,
      targets: [{ kind: "next_reply", minutes: 60 }],
    };

    const commitment = createCommitment(
      "case-1",
      "next_reply",
      "2026-09-07T10:00:00.000Z",
      policy,
      calendar,
      "next_reply:zendesk:raw_7:customer_replied:2026-09-07T10:00:00.000Z",
    );

    expect(commitment).toMatchObject({
      kind: "next_reply",
      cycleKey:
        "next_reply:zendesk:raw_7:customer_replied:2026-09-07T10:00:00.000Z",
      startedAt: "2026-09-07T10:00:00.000Z",
      targetMinutes: 60,
      dueAt: "2026-09-07T11:00:00.000Z",
    });
  });

  it("throws when the policy has no target for the requested kind", () => {
    expect(() =>
      createCommitment(
        "case-1",
        "first_response",
        "2026-09-07T09:00:00.000Z",
        p1Policy,
        calendar,
      ),
    ).toThrow();
  });
});

describe("resolveCommitmentPolicyChange", () => {
  it("reports no change when the matched policy version is the commitment's current one", () => {
    const resolution = resolveCommitmentPolicyChange(
      { kind: "resolution" },
      genericPolicy.policyId,
      genericPolicy,
    );

    expect(resolution).toEqual({
      changed: false,
      hasTarget: true,
    });
  });

  it("D1: reports no change for a new version of the SAME policy — an override, re-import, or policy-UI edit never re-resolves", () => {
    const resolution = resolveCommitmentPolicyChange(
      { kind: "resolution" },
      p1Policy.policyId,
      p1Tier1Policy,
    );

    expect(resolution).toEqual({
      changed: false,
      hasTarget: true,
    });
  });

  it("reports a change generically when a genuinely different policy now matches — the comparison never inspects which CaseAttributes field moved", () => {
    const resolution = resolveCommitmentPolicyChange(
      { kind: "resolution" },
      genericPolicy.policyId,
      otherPolicy,
    );

    expect(resolution).toEqual({
      changed: true,
      hasTarget: true,
    });
  });

  it("flags a missing target when the newly matched (different) policy has no target for the commitment's kind", () => {
    const noNextReply: SLAPolicyVersion = {
      ...otherPolicy,
      id: "policy-no-next-reply",
    };

    const resolution = resolveCommitmentPolicyChange(
      { kind: "next_reply" },
      genericPolicy.policyId,
      noNextReply,
    );

    expect(resolution).toEqual({
      changed: true,
      hasTarget: false,
    });
  });
});
