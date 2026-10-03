import { describe, expect, it } from "vitest";
import { addMonthsUtc, defaultSeatQuantity, isSelfServePlan, isUpgrade, planPriceCents, previewNextInvoice, seatBounds } from "../src/billing";
import { effectiveLimit, evaluateCreation } from "../src/entitlements";
import { PLANS } from "../src/plans";

const usage = { seats: 3, ticketSourceIntegrations: 0, engineeringIntegrations: 0, nativePolicies: 0 };
const NOW = new Date("2026-10-03T00:00:00.000Z");

describe("billing pricing comes from PLANS", () => {
  it("prices plans in cents, with Enterprise custom and contract-only", () => {
    expect(planPriceCents("starter")).toBe(PLANS.starter.monthlyPriceUsd! * 100);
    expect(planPriceCents("team")).toBe(14_900);
    expect(planPriceCents("enterprise")).toBeNull();
    expect(isSelfServePlan("team")).toBe(true);
    expect(isSelfServePlan("enterprise")).toBe(false);
    expect(isUpgrade("starter", "team")).toBe(true);
    expect(isUpgrade("team", "starter")).toBe(false);
  });

  it("bounds seats by what is in use and the plan's limit", () => {
    expect(seatBounds("starter", 3)).toEqual({ min: 3, max: 5 });
    expect(seatBounds("team", 0)).toEqual({ min: 1, max: 20 });
    expect(seatBounds("enterprise", 40).max).toBeGreaterThan(40);
    expect(defaultSeatQuantity("team", 3)).toBe(20);
    expect(defaultSeatQuantity("enterprise", 7)).toBe(7);
  });

  it("adds months keeping the anchor day, clamped to short months", () => {
    expect(addMonthsUtc(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonthsUtc(new Date("2026-12-15T00:00:00Z"), 1).toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });

  it("previews the next invoice on the plan it renews onto", () => {
    const base = { status: "active" as const, plan: "team", pendingPlan: null, seatQuantity: 10, cancelAtPeriodEnd: false, currentPeriodEnd: NOW, trialEndsAt: null };
    expect(previewNextInvoice(base)).toMatchObject({ plan: "team", amountCents: 14_900, chargeAt: NOW });
    expect(previewNextInvoice({ ...base, pendingPlan: "starter" })).toMatchObject({ plan: "starter", amountCents: 4_900 });
    expect(previewNextInvoice({ ...base, cancelAtPeriodEnd: true })).toBeNull();
    expect(previewNextInvoice({ ...base, status: "cancelled" })).toBeNull();
  });
});

describe("entitlements read the licensed seats", () => {
  it("narrows the plan's seat limit to the licensed seats, other limits unchanged", () => {
    expect(effectiveLimit({ plan: "team", seatQuantity: 8 }, "seats")).toBe(8);
    expect(effectiveLimit({ plan: "team", seatQuantity: null }, "seats")).toBe(20);
    expect(effectiveLimit({ plan: "enterprise", seatQuantity: 30 }, "seats")).toBe(30);
    expect(effectiveLimit({ plan: "starter", seatQuantity: 4 }, "nativePolicies")).toBe(3);
    expect(effectiveLimit({ plan: null, seatQuantity: 4 }, "seats")).toBeNull();
  });

  it("warns when a creation reaches the licensed seats", () => {
    const subject = { plan: "team", planStatus: "active" as const, trialEndsAt: null, seatQuantity: 4 };
    expect(evaluateCreation(subject, usage, "seats", NOW)).toEqual({ outcome: "warn", resource: "seats", used: 4, limit: 4 });
    expect(evaluateCreation({ ...subject, seatQuantity: 10 }, usage, "seats", NOW)).toEqual({ outcome: "allow" });
  });
});
