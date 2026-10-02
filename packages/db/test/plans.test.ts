import { describe, expect, it } from "vitest";
import { formatPlanPrice, isPlanId, LIMITED_RESOURCES, PLAN_IDS, PLAN_LIST, PLANS, planFeatureLines } from "../src/plans";

describe("plan constant (N6.1, D14)", () => {
  it("defines exactly Starter $49, Team $149 and Enterprise custom", () => {
    expect(PLAN_IDS).toEqual(["starter", "team", "enterprise"]);
    expect(PLAN_LIST.map((plan) => formatPlanPrice(plan))).toEqual([
      { price: "$49", cadence: "/month" },
      { price: "$149", cadence: "/month" },
      { price: "Custom", cadence: "" },
    ]);
  });

  it("never carries the obsolete pilot or escalation-model prices", () => {
    const prices = PLAN_LIST.map((plan) => plan.monthlyPriceUsd);
    for (const obsolete of [299, 699, 79, 249]) expect(prices).not.toContain(obsolete);
  });

  it("keys every plan by its own id and gives each one a limit for every resource", () => {
    for (const id of PLAN_IDS) {
      expect(PLANS[id].id).toBe(id);
      expect(Object.keys(PLANS[id].limits).sort()).toEqual([...LIMITED_RESOURCES].sort());
    }
  });

  it("states the seat-based limits the pricing page advertises", () => {
    expect(PLANS.starter.limits).toEqual({ seats: 5, ticketSourceIntegrations: 1, engineeringIntegrations: 1, nativePolicies: 3 });
    expect(PLANS.team.limits.seats).toBe(20);
    expect(PLANS.team.limits.nativePolicies).toBeNull();
    expect(Object.values(PLANS.enterprise.limits).every((limit) => limit === null)).toBe(true);
  });

  it("derives the advertised bullet lines from the limits", () => {
    expect(planFeatureLines(PLANS.starter)).toEqual(
      expect.arrayContaining(["Up to 3 SLA policies", "5 seats", "1 support integration (Zendesk or Intercom) and 1 engineering integration"]),
    );
    expect(planFeatureLines(PLANS.team)).toEqual(expect.arrayContaining(["20 seats", "Unlimited SLA policies and calendars"]));
    expect(planFeatureLines(PLANS.enterprise)).toEqual(expect.arrayContaining(["Unlimited seats"]));
  });

  it("claims no feature that is not built", () => {
    const text = PLAN_LIST.flatMap(planFeatureLines).join("\n").toLowerCase();
    for (const claim of ["sso", "saml", "retention", "90-day", "prorat"]) expect(text).not.toContain(claim);
  });

  it("recognises only its own ids", () => {
    expect(isPlanId("team")).toBe(true);
    expect(isPlanId("growth")).toBe(false);
    expect(isPlanId(null)).toBe(false);
  });
});
