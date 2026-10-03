import { describe, expect, it } from "vitest";
import { toBillingRow, describeBillingEvent, type BillingRowInput } from "../src/lib/admin-billing-data";
import {
  billingKpis,
  countByHealth,
  countByStatus,
  countByTier,
  DEFAULT_BILLING_CONTROLS,
  dunningQueue,
  selectBillingTenants,
} from "../src/lib/admin-billing-list";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const day = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

function input(id: string, overrides: Partial<BillingRowInput> & { plan?: string | null; status?: BillingRowInput["organization"]["planStatus"] } = {}): BillingRowInput {
  const { plan = "team", status = "active", ...rest } = overrides;
  return {
    organization: { id, name: `Org ${id}`, plan, planStatus: status, trialEndsAt: null, createdAt: day(-100) },
    subscription:
      plan === null
        ? null
        : {
            plan,
            status,
            seatQuantity: 10,
            unitPriceCents: plan === "enterprise" ? null : plan === "team" ? 14_900 : 4_900,
            currentPeriodEnd: day(10),
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
            endedAt: null,
            pendingPlan: null,
          },
    ownerEmail: `owner@${id}.test`,
    seatsUsed: 4,
    openCents: 0,
    oldestDueAt: null,
    ingress24h: 0,
    ...rest,
  };
}

const rows = [
  toBillingRow(input("acme"), NOW),
  toBillingRow(input("late", { status: "past_due", openCents: 14_900, oldestDueAt: day(-6) }), NOW),
  toBillingRow(input("later", { plan: "starter", status: "past_due", openCents: 4_900, oldestDueAt: day(-2) }), NOW),
  toBillingRow(input("trial", { plan: null, status: "trial" }), NOW),
  toBillingRow(input("big", { plan: "enterprise", seatsUsed: 40 }), NOW),
];

describe("directory rows from the billing domain", () => {
  it("derives state, tags, MRR and health", () => {
    expect(rows[0]).toMatchObject({ tier: "team", status: "active", mrrCents: 14_900, health: "healthy", tag: null, rateNote: { text: "Direct invoice" } });
    expect(rows[1]).toMatchObject({ status: "past_due", overdueDays: 6, health: "overdue", tag: { label: "Dunning" } });
    expect(rows[3]).toMatchObject({ tier: "none", status: "trialing", hasSubscription: false, mrrCents: 0 });
    expect(rows[4]).toMatchObject({ tier: "enterprise", rateCents: null, mrrCents: 0, rateNote: { text: "Contract" } });
  });

  it("marks a scheduled cancellation as ending", () => {
    const ending = input("bye");
    ending.subscription!.cancelAtPeriodEnd = true;
    expect(toBillingRow(ending, NOW)).toMatchObject({ health: "expiring", tag: { label: "Ending" }, nextBillingAt: null });
  });
});

describe("admin billing directory controls", () => {
  it("searches, filters and sorts", () => {
    const select = (patch: Partial<typeof DEFAULT_BILLING_CONTROLS>) => selectBillingTenants(rows, { ...DEFAULT_BILLING_CONTROLS, ...patch }).map((row) => row.id);
    expect(select({ query: "owner@acme" })).toEqual(["acme"]);
    expect(select({ plan: "none" })).toEqual(["trial"]);
    expect(select({ status: "past_due", sort: "delinquency" })).toEqual(["late", "later"]);
    expect(select({ health: "overdue" }).sort()).toEqual(["late", "later"]);
    expect(select({ sort: "seats_desc" })[0]).toBe("big");
  });

  it("counts for the filter pills and headline figures", () => {
    expect(countByTier(rows)).toEqual({ all: 5, enterprise: 1, team: 2, starter: 1, none: 1 });
    expect(countByStatus(rows)).toEqual({ all: 5, active: 2, trialing: 1, past_due: 2 });
    expect(countByHealth(rows)).toEqual({ healthy: 3, expiring: 0, overdue: 2 });

    const kpis = billingKpis(rows);
    expect(kpis).toMatchObject({ mrrCents: 14_900 * 2 + 4_900, atRiskCents: 19_800, maxOverdueDays: 6, pastDue: 2, trialing: 1 });
    expect(kpis.arrCents).toBe(kpis.mrrCents * 12);
    expect(dunningQueue(rows).map((item) => [item.tenantId, item.overdueDays])).toEqual([
      ["late", 6],
      ["later", 2],
    ]);
  });
});

describe("lifecycle stream wording", () => {
  it("describes billing events for the operator", () => {
    expect(describeBillingEvent("plan_changed", { from: "starter", to: "team" })).toMatchObject({ group: "plan", title: "Tier change: Starter → Team" });
    expect(describeBillingEvent("invoice_paid", { number: "INV-2026-001", totalCents: 14_900 })).toMatchObject({ group: "payments", tone: "success" });
    expect(describeBillingEvent("operator_note", { note: "Called" })).toMatchObject({ group: "notes", body: "Called" });
  });
});
