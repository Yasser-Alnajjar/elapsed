import { describe, expect, it } from "vitest";
import { toPolicyVersionDomain, type PolicyVersionDomainRow } from "../src/policy-domain";

const row: PolicyVersionDomainRow = {
  id: "pv_1",
  policyId: "p_1",
  version: 3,
  match: { priority: ["high"] },
  targets: [{ kind: "first_response", minutes: 30 }],
  pauseOnStates: ["waiting_on_customer"],
  calendarVersionId: "cal_1",
  warnAtPercent: [80],
  effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
  calendarIsExplicit: false,
  policy: { position: 2, source: "imported", sourceProvider: "some-source" },
};

describe("toPolicyVersionDomain", () => {
  it("maps the version and its owning policy's ordering, ownership and source scope", () => {
    expect(toPolicyVersionDomain(row)).toEqual({
      id: "pv_1",
      policyId: "p_1",
      version: 3,
      match: { priority: ["high"] },
      targets: [{ kind: "first_response", minutes: 30 }],
      pauseOnStates: ["waiting_on_customer"],
      calendarVersionId: "cal_1",
      warnAtPercent: [80],
      effectiveFrom: "2026-09-01T00:00:00.000Z",
      policyPosition: 2,
      policySource: "imported",
      sourceKey: "some-source",
      calendarIsExplicit: false,
    });
  });

  it("carries a native policy's null source through as an unscoped key", () => {
    const native = toPolicyVersionDomain({ ...row, policy: { position: null, source: "native", sourceProvider: null } });
    expect(native.sourceKey).toBeNull();
    expect(native.policySource).toBe("native");
  });
});
