import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PLAN_LIST, type PlanId } from "@sla/db/plans";
import { resolveSubscribeReview } from "../src/lib/billing-subscribe";
import { resolvePricingViewer, subscribeHref } from "../src/lib/pricing-viewer";
import type { BillingInvoice, BillingOverviewData, PlanOption, SubscriptionSummary } from "../src/lib/types/billing";

vi.mock("@/components/shared/reveal", () => ({ Reveal: ({ children }: { children: unknown }) => children }));

/**
 * The pricing page's viewer states and the Review & Subscribe model, from
 * hand-built billing overviews. They only word what `planOptions` and the
 * subscription already say, so each case builds the overview the billing read
 * model would produce for that situation.
 */

const NOW = "2026-10-08T12:00:00.000Z";
const iso = (value: string) => new Date(value).toISOString();

function subscription(overrides: Partial<SubscriptionSummary> = {}): SubscriptionSummary {
  return {
    planId: "team",
    planName: "Team",
    status: "active",
    interval: "month",
    amountCents: 14_900,
    currency: "USD",
    currentPeriodStart: iso("2026-10-03T00:00:00Z"),
    currentPeriodEnd: iso("2026-11-03T00:00:00Z"),
    renewsAt: iso("2026-11-03T00:00:00Z"),
    trialEndsAt: null,
    subscribedSince: iso("2026-07-03T00:00:00Z"),
    cancelAtPeriodEnd: false,
    endedAt: null,
    pendingPlan: null,
    seatQuantity: 20,
    version: 4,
    ...overrides,
  };
}

/** The plan options as `planOptionsFor` derives them: effect by upgrade/downgrade, seats blocking a smaller plan. */
function options(current: PlanId | null, opts: { seatsInUse: number; trialing?: boolean; pending?: PlanId | null; live?: boolean }): PlanOption[] {
  const rank: PlanId[] = ["starter", "team", "enterprise"];
  return PLAN_LIST.map((plan) => {
    const limit = plan.limits.seats;
    const isCurrent = current === plan.id;
    const effect: PlanOption["effect"] = isCurrent
      ? null
      : !opts.live || opts.trialing || rank.indexOf(plan.id) > rank.indexOf(current!)
        ? "now"
        : "period_end";
    return {
      id: plan.id,
      name: plan.name,
      priceLabel: plan.monthlyPriceUsd === null ? "Custom" : `$${plan.monthlyPriceUsd}`,
      summary: "",
      current: isCurrent,
      pending: opts.pending === plan.id,
      selfServe: plan.monthlyPriceUsd !== null,
      unavailableReason: limit !== null && opts.seatsInUse > limit ? `${opts.seatsInUse} seats are in use; ${plan.name} allows ${limit}.` : null,
      effect,
    };
  });
}

function quota(id: string, label: string, used: number) {
  return { id, label, description: "", included: true, value: { kind: "quota" as const, used, limit: null, unit: "" } };
}

function overview(overrides: Partial<BillingOverviewData> = {}, seatsInUse = 7): BillingOverviewData {
  const sub = overrides.subscription === undefined ? subscription() : overrides.subscription;
  const live = sub && sub.status !== "cancelled" ? sub : null;
  return {
    organizationName: "Dataship Global",
    canManage: true,
    providerAvailable: false,
    internal: false,
    asOf: NOW,
    subscription: sub,
    trial: null,
    effectivePlan: live ? { id: live.planId, name: live.planName } : null,
    seats: { used: seatsInUse, licensed: live?.seatQuantity ?? null, planLimit: null, min: seatsInUse, max: 20 },
    events: { used: 0, dailyAverage: 0 },
    paymentMethod: null,
    entitlements: [
      quota("seats", "Seats", seatsInUse),
      quota("support-integrations", "Support integrations", 1),
      quota("engineering-integrations", "Engineering integrations", 1),
      quota("sla-policies", "SLA policies", 3),
    ],
    upcomingInvoice: null,
    usage: [],
    recommendation: null,
    planOptions: options(live?.planId ?? null, { seatsInUse, live: Boolean(live), trialing: live?.status === "trialing", pending: live?.pendingPlan?.id }),
    invoices: [],
    profile: { billingEmail: "billing@dataship.io", legalName: null, addressLines: [], country: null, taxId: null, ccEmails: [] },
    ...overrides,
  };
}

const trialOwner = (seatsInUse = 4) => overview({ subscription: null, trial: { endsAt: iso("2026-10-17T00:00:00Z"), expired: false } }, seatsInUse);
const trialEnded = (seatsInUse = 4) => overview({ subscription: null, trial: { endsAt: iso("2026-10-03T00:00:00Z"), expired: true } }, seatsInUse);
const cancelled = (seatsInUse = 4) =>
  overview({ subscription: subscription({ status: "cancelled", endedAt: iso("2026-10-01T00:00:00Z"), renewsAt: null }) }, seatsInUse);

describe("pricing viewer", () => {
  it("sends a visitor to sign up with the trial promise and no context strip", () => {
    const viewer = resolvePricingViewer(null);
    expect(viewer.mode).toBe("anonymous");
    expect(viewer.strip).toBeNull();
    expect(viewer.cards.starter.cta).toEqual({ kind: "link", label: "Start free trial", href: "/sign-up" });
    expect(viewer.cards.team.helper).toMatch(/14 days full access/);
    expect(viewer.cards.enterprise.cta).toEqual({ kind: "contact" });
  });

  it("gives a member a read-only view: disabled CTAs, the current plan, and the owner-only reason", () => {
    const viewer = resolvePricingViewer(overview({ canManage: false }));
    expect(viewer.mode).toBe("member");
    expect(viewer.strip?.aside?.label).toBe("Read-only view");
    expect(viewer.strip?.details).toContain("Current plan: Team");
    expect(viewer.cards.team.cta).toMatchObject({ kind: "disabled", label: "Current plan" });
    expect(viewer.cards.team.pill?.label).toBe("Current plan");
    expect(viewer.cards.starter.cta.kind).toBe("disabled");
    expect(viewer.cards.starter.helper).toBe("Only an organization owner can manage billing.");
    expect(viewer.cards.enterprise.cta).toEqual({ kind: "contact" });
  });

  it("offers an owner in a live trial the review screen, with billing starting at trial end", () => {
    const viewer = resolvePricingViewer(trialOwner());
    expect(viewer.mode).toBe("owner");
    expect(viewer.strip).toMatchObject({ title: "Trial", pulse: true });
    expect(viewer.strip?.details[0]).toBe("ends Oct 17, 2026 (9 days remaining)");
    expect(viewer.cards.team.cta).toEqual({ kind: "link", label: "Choose Team", href: subscribeHref("team") });
    expect(viewer.cards.team.helper).toBe("Billing starts when your trial ends on Oct 17, 2026.");
  });

  it("asks an owner whose trial ended, or subscription ended, to subscribe now", () => {
    for (const data of [trialEnded(), cancelled()]) {
      const viewer = resolvePricingViewer(data);
      expect(viewer.strip?.tone).toBe("warning");
      expect(viewer.cards.team.cta).toEqual({ kind: "link", label: "Subscribe to Team", href: "/billing/subscribe?plan=team" });
      expect(viewer.cards.starter.helper).toBe("Starts now; the first invoice is issued today.");
    }
    expect(resolvePricingViewer(trialEnded()).strip?.title).toBe("Trial ended");
    expect(resolvePricingViewer(cancelled()).strip?.title).toBe("Subscription ended");
  });

  it("marks the active plan, offers a downgrade at period end and no self-serve Enterprise", () => {
    const viewer = resolvePricingViewer(overview({}, 4));
    expect(viewer.strip?.details).toEqual(["Active", "Renews Nov 3, 2026"]);
    expect(viewer.cards.team.cta).toMatchObject({ kind: "disabled", label: "Current plan" });
    expect(viewer.cards.team.pill).toEqual({ label: "Active plan", tone: "success" });
    expect(viewer.cards.team.footerLink?.href).toBe("/billing");
    expect(viewer.cards.starter.cta).toEqual({ kind: "link", label: "Downgrade to Starter", href: subscribeHref("starter") });
    expect(viewer.cards.starter.helper).toBe("Takes effect Nov 3, 2026");
    expect(viewer.cards.enterprise.cta).toEqual({ kind: "contact" });
  });

  it("offers a Starter owner an upgrade that applies now", () => {
    const viewer = resolvePricingViewer(
      overview({ subscription: subscription({ planId: "starter", planName: "Starter", amountCents: 4_900, seatQuantity: 5 }) }, 4),
    );
    expect(viewer.cards.starter.cta).toMatchObject({ kind: "disabled", label: "Current plan" });
    expect(viewer.cards.team.cta).toEqual({ kind: "link", label: "Upgrade to Team", href: subscribeHref("team") });
    expect(viewer.cards.team.helper).toBe("Applies now; the price difference for this period is invoiced.");
  });

  it("shows a scheduled downgrade and lets the owner keep the current plan", () => {
    const viewer = resolvePricingViewer(overview({ subscription: subscription({ pendingPlan: { id: "starter", name: "Starter" } }) }, 4));
    expect(viewer.strip?.title).toBe("Moves to Starter on Nov 3, 2026");
    expect(viewer.cards.starter.cta).toMatchObject({ kind: "disabled", label: "Scheduled for Nov 3, 2026" });
    expect(viewer.cards.starter.pill?.label).toBe("Scheduled");
    expect(viewer.cards.team.cta).toEqual({ kind: "link", label: "Keep Team", href: subscribeHref("team") });
  });

  it("blocks a downgrade the seats in use do not fit, and points to members", () => {
    const viewer = resolvePricingViewer(overview({}, 7));
    expect(viewer.cards.starter.cta).toEqual({ kind: "disabled", label: "7 seats are in use; Starter allows 5", tone: "danger" });
    expect(viewer.cards.starter.footerLink).toEqual({ label: "Manage members →", href: "/settings/members" });
  });

  it("flags a past-due subscription and links the overdue invoice", () => {
    const overdue = { number: "INV-2026-009", status: "open", dueAt: iso("2026-10-01T00:00:00Z") } as BillingInvoice;
    const viewer = resolvePricingViewer(overview({ subscription: subscription({ status: "past_due" }), invoices: [overdue] }, 4));
    expect(viewer.strip).toMatchObject({ tone: "danger", title: "Past due · Direct invoice INV-2026-009" });
    expect(viewer.strip?.aside?.href).toBe("/billing?tab=invoices");
    expect(viewer.cards.team.cta).toMatchObject({ kind: "disabled", label: "Current plan (past due)" });
    expect(viewer.cards.team.footerLink?.href).toBe("/billing?tab=invoices");
  });

  it("offers a scheduled cancellation as a resume", () => {
    const viewer = resolvePricingViewer(overview({ subscription: subscription({ cancelAtPeriodEnd: true, renewsAt: null }) }, 4));
    expect(viewer.strip?.title).toBe("Team ends Nov 3, 2026");
    expect(viewer.cards.team.cta).toEqual({ kind: "link", label: "Resume Team", href: subscribeHref("team") });
  });

  it("leaves every plan not applicable for an internal organization", () => {
    const viewer = resolvePricingViewer(overview({ internal: true, subscription: null }));
    expect(viewer.mode).toBe("internal");
    expect(viewer.strip?.details).toEqual(["Your organization is not billed"]);
    for (const card of Object.values(viewer.cards)) expect(card.cta).toMatchObject({ kind: "disabled", label: "Not applicable" });
  });
});

describe("review & subscribe", () => {
  it("starts during a trial: billing begins at trial end and no invoice is due today", () => {
    const review = resolveSubscribeReview(trialOwner(7), "team");
    expect(review.change).toBe("start_trial");
    expect(review.block).toBeNull();
    expect(review.action).toEqual({ action: "start", plan: "team" });
    expect(review.effect.headline).toBe("Billing starts when your trial ends on Oct 17, 2026");
    expect(review.invoice).toMatchObject({ totalCents: 14_900, dueAt: iso("2026-10-31T00:00:00Z"), dueNote: "14 days after trial" });
    expect(review.seatsLine).toBe("20 licensed seats (7 in use) · adjustable later in Billing");
    expect(review.cta).toEqual({ label: "Start Team subscription", disabled: false });
    expect(review.limits.find((row) => row.id === "seats")).toMatchObject({ used: 7, limit: 20, percent: 35 });
  });

  it("starts now after a trial ended: the first invoice is issued today on net 14", () => {
    const review = resolveSubscribeReview(trialEnded(), "team");
    expect(review.change).toBe("start_now");
    expect(review.action).toEqual({ action: "start", plan: "team" });
    expect(review.alert?.title).toBe("Trial ended Oct 3, 2026");
    expect(review.invoice).toMatchObject({ dueAt: iso("2026-10-22T12:00:00Z"), dueNote: "14 days after issue" });
    expect(review.cta.label).toBe("Subscribe to Team");
  });

  it("restarts an ended subscription with the same start operation", () => {
    const review = resolveSubscribeReview(cancelled(), "starter");
    expect(review.change).toBe("start_now");
    expect(review.statusPill.label).toBe("Subscription ended");
  });

  it("switches plans during a subscription trial with no proration", () => {
    const sub = subscription({ planId: "starter", planName: "Starter", amountCents: 4_900, status: "trialing", trialEndsAt: iso("2026-10-17T00:00:00Z"), currentPeriodEnd: iso("2026-10-17T00:00:00Z"), renewsAt: iso("2026-10-17T00:00:00Z") });
    const review = resolveSubscribeReview(overview({ subscription: sub }, 4), "team");
    expect(review.change).toBe("change_trial");
    expect(review.action).toEqual({ action: "change_plan", plan: "team", expectedVersion: 4 });
    expect(review.effect.headline).toBe("Applies now (no proration during trial)");
    expect(review.invoice?.dueAt).toBe(iso("2026-10-31T00:00:00Z"));
  });

  it("upgrades now and previews the prorated difference the change itself would charge", () => {
    const sub = subscription({ planId: "starter", planName: "Starter", amountCents: 4_900, seatQuantity: 5 });
    const review = resolveSubscribeReview(overview({ subscription: sub }, 4), "team");
    expect(review.change).toBe("upgrade");
    expect(review.action).toEqual({ action: "change_plan", plan: "team", expectedVersion: 4 });
    // $100 difference for 26 of the 31 days left in the period at the page's time.
    const periodMs = Date.parse(sub.currentPeriodEnd) - Date.parse(sub.currentPeriodStart);
    const remainingMs = Date.parse(sub.currentPeriodEnd) - Date.parse(NOW);
    const expected = Math.round((10_000 * remainingMs) / periodMs);
    expect(review.invoice).toMatchObject({ totalCents: expected, estimated: true, dueNote: "14 days after issue" });
    expect(review.invoice?.lines).toHaveLength(1);
    expect(review.invoice?.followUp).toBe("Then Team renews at $149.00/mo on Nov 3, 2026.");
    // The domain keeps the licensed count on an upgrade; the owner raises it later.
    expect(review.seatsLine).toBe("5 licensed seats (4 in use) · adjustable later in Billing");
    expect(review.limits.find((row) => row.id === "seats")).toMatchObject({ used: 4, limit: 5, note: "80% utilized · 1 remaining. Up to 20 on this plan." });
  });

  it("refuses to start a plan the seats in use do not fit", () => {
    const review = resolveSubscribeReview(trialEnded(7), "starter");
    expect(review.change).toBe("start_now");
    expect(review.block?.reason).toBe("seats");
    expect(review.action).toBeNull();
    expect(resolvePricingViewer(trialEnded(7)).cards.starter.cta).toMatchObject({ kind: "disabled", label: "7 seats are in use; Starter allows 5" });
  });

  it("schedules a downgrade for the end of the period and withdraws it with the current plan", () => {
    const downgrade = resolveSubscribeReview(overview({}, 4), "starter");
    expect(downgrade.change).toBe("downgrade");
    expect(downgrade.action).toEqual({ action: "change_plan", plan: "starter", expectedVersion: 4 });
    expect(downgrade.effect.headline).toBe("Takes effect Nov 3, 2026");
    expect(downgrade.invoice).toMatchObject({ totalCents: 4_900, dueAt: iso("2026-11-17T00:00:00Z") });
    expect(downgrade.seatsLine).toContain("5 licensed seats (4 in use)");

    const pending = overview({ subscription: subscription({ pendingPlan: { id: "starter", name: "Starter" } }) }, 4);
    const keep = resolveSubscribeReview(pending, "team");
    expect(keep.change).toBe("keep");
    expect(keep.action).toEqual({ action: "change_plan", plan: "team", expectedVersion: 4 });
    expect(keep.cta.label).toBe("Keep Team");

    const again = resolveSubscribeReview(pending, "starter");
    expect(again.block?.reason).toBe("scheduled");
    expect(again.action).toBeNull();
  });

  it("resumes a scheduled cancellation with the resume operation", () => {
    const review = resolveSubscribeReview(overview({ subscription: subscription({ cancelAtPeriodEnd: true, renewsAt: null }) }, 4), "team");
    expect(review.change).toBe("resume");
    expect(review.action).toEqual({ action: "resume", expectedVersion: 4 });
    expect(review.cta.label).toBe("Resume Team");
  });

  it("blocks the current plan, the seat overage, a member and an internal organization", () => {
    expect(resolveSubscribeReview(overview({}, 4), "team")).toMatchObject({ block: { reason: "current" }, action: null, cta: { label: "Already on Team", disabled: true } });

    const seats = resolveSubscribeReview(overview({}, 7), "starter");
    expect(seats.block?.reason).toBe("seats");
    expect(seats.alert?.link?.href).toBe("/settings/members");
    expect(seats.effect.detail).toBe("Remove 2 seats to continue.");
    expect(seats.limits.find((row) => row.id === "seats")).toMatchObject({ used: 7, limit: 5, tone: "danger" });
    expect(seats.action).toBeNull();

    const member = resolveSubscribeReview(overview({ canManage: false }, 4), "starter");
    expect(member.block?.reason).toBe("read_only");
    expect(member.action).toBeNull();
    expect(member.cta).toEqual({ label: "Owner approval required", disabled: true });

    const internal = resolveSubscribeReview(overview({ internal: true, subscription: null }), "team");
    expect(internal.block?.reason).toBe("internal");
    expect(internal.invoice).toBeNull();
    expect(internal.action).toBeNull();
  });

  it("treats Enterprise as a contact, never a subscription operation", () => {
    const review = resolveSubscribeReview(overview({}, 4), "enterprise");
    expect(review.change).toBe("none");
    expect(review.block?.reason).toBe("contact");
    expect(review.action).toBeNull();
    expect(review.priceCents).toBeNull();
    expect(review.invoice?.totalCents).toBeNull();
    expect(review.cta.label).toBe("Talk to us");
  });
});

describe("pricing page rendering", () => {
  const render = async (data: BillingOverviewData | null) => {
    const { PricingView } = await import("../src/modules/marketing/pricing/csr/PricingView");
    return renderToStaticMarkup(createElement(PricingView, { viewer: resolvePricingViewer(data) }));
  };

  it("links a visitor to sign-up and an owner to the review screen, and disables a member's CTAs", async () => {
    const visitor = await render(null);
    expect(visitor).toContain('href="/sign-up"');
    expect(visitor).not.toContain("/billing/subscribe");

    const owner = await render(trialOwner());
    expect(owner).toContain('href="/billing/subscribe?plan=team"');
    expect(owner).toContain('href="/billing/subscribe?plan=starter"');
    expect(owner).toContain("Trial");

    const member = await render(overview({ canManage: false }, 4));
    expect(member).not.toContain("/billing/subscribe");
    expect(member).toContain("Only an organization owner can manage billing.");
    expect(member).toContain("Read-only view");
  });
});
