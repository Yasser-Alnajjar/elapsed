import { PLAN_IDS, TRIAL_LENGTH_DAYS, type PlanId } from "@sla/db/plans";
import { daysBetween, formatBillingDate } from "@/lib/billing-format";
import type { BillingOverviewData, BillingTone, PlanOption, SubscriptionSummary } from "@/lib/types/billing";
import type { PricingCardState, PricingContextStrip, PricingCta, PricingViewer } from "@/lib/types/pricing";

/**
 * The public pricing page, aware of who is looking (N6.5). Every state comes
 * from the billing read model (`getBillingOverview`): the subscription, the
 * trial, and `planOptions`, which already decide per plan whether a change
 * applies now or at period end and whether the seats in use block it. Nothing
 * here re-derives billing rules; it only words them as a button and a line.
 *
 * `null` is a visitor with no session.
 */

export const OWNER_ONLY_MESSAGE = "Only an organization owner can manage billing.";
const BILLING_HREF = "/billing";
const INVOICES_HREF = "/billing?tab=invoices";
const MEMBERS_HREF = "/settings/members";

/** The review screen for one plan; it works out for itself whether that is a start, a change, a keep or a resume. */
export const subscribeHref = (plan: PlanId) => `/billing/subscribe?plan=${plan}`;

type Live = SubscriptionSummary;

function liveSubscription(data: BillingOverviewData): Live | null {
  return data.subscription && data.subscription.status !== "cancelled" ? data.subscription : null;
}

/** The date a trial or period ends and the next charge falls. */
function boundaryOf(subscription: Live): string {
  return subscription.status === "trialing" ? subscription.trialEndsAt ?? subscription.currentPeriodEnd : subscription.currentPeriodEnd;
}

/** The overdue open invoice behind a `past_due` status, if one is on file. */
function overdueInvoiceNumber(data: BillingOverviewData): string | null {
  const now = new Date(data.asOf).getTime();
  return data.invoices.find((invoice) => invoice.status === "open" && new Date(invoice.dueAt).getTime() < now)?.number ?? null;
}

const disabled = (label: string, tone: BillingTone | null = null): PricingCta => ({ kind: "disabled", label, tone });

function emptyCard(planId: PlanId): PricingCardState {
  return { planId, pill: null, cta: { kind: "contact" }, helper: null, footerLink: null };
}

function allCards(build: (planId: PlanId) => PricingCardState): PricingViewer["cards"] {
  return Object.fromEntries(PLAN_IDS.map((id) => [id, build(id)])) as PricingViewer["cards"];
}

function anonymous(): PricingViewer {
  const helper = `${TRIAL_LENGTH_DAYS} days full access · No card required`;
  return {
    mode: "anonymous",
    strip: null,
    cards: allCards((planId) =>
      planId === "enterprise" ? emptyCard(planId) : { ...emptyCard(planId), cta: { kind: "link", label: "Start free trial", href: "/sign-up" }, helper },
    ),
  };
}

function internal(data: BillingOverviewData): PricingViewer {
  return {
    mode: "internal",
    strip: {
      tone: "primary",
      pulse: false,
      title: data.organizationName,
      details: ["Your organization is not billed"],
      aside: { label: "Internal tier", tone: "primary" },
    },
    cards: allCards((planId) => ({
      planId,
      pill: planId === "team" ? { label: "Internal", tone: "primary" } : null,
      cta: disabled("Not applicable"),
      helper: "Internal organizations are not billed.",
      footerLink: null,
    })),
  };
}

function stripFor(data: BillingOverviewData, live: Live | null, owner: boolean): PricingContextStrip | null {
  const { subscription, trial } = data;

  if (!owner) {
    return {
      tone: "primary",
      pulse: false,
      title: data.organizationName,
      details: [data.effectivePlan ? `Current plan: ${data.effectivePlan.name}` : trial && !trial.expired ? "Trial" : "No plan yet"],
      aside: { label: "Read-only view" },
    };
  }

  if (!live) {
    if (trial && !trial.expired && trial.endsAt) {
      const days = Math.max(0, daysBetween(data.asOf, trial.endsAt));
      return {
        tone: "primary",
        pulse: true,
        title: "Trial",
        details: [`ends ${formatBillingDate(trial.endsAt)} (${days} ${days === 1 ? "day" : "days"} remaining)`],
        aside: { label: "All features active", tone: "primary" },
      };
    }
    return {
      tone: "warning",
      pulse: false,
      title: subscription ? "Subscription ended" : "Trial ended",
      details: ["Monitoring keeps running uninterrupted"],
      aside: { label: "Action required", tone: "warning" },
    };
  }

  const manage = { label: "Manage in Billing →", href: BILLING_HREF };
  if (live.cancelAtPeriodEnd) {
    return {
      tone: "warning",
      pulse: false,
      title: `${live.planName} ends ${formatBillingDate(live.currentPeriodEnd)}`,
      details: ["Cancellation scheduled"],
      aside: { label: "Resume →", href: subscribeHref(live.planId), tone: "warning" },
    };
  }
  if (live.pendingPlan) {
    return {
      tone: "warning",
      pulse: false,
      title: `Moves to ${live.pendingPlan.name} on ${formatBillingDate(live.currentPeriodEnd)}`,
      details: [`Currently ${live.status === "trialing" ? "on trial" : "active"} on ${live.planName}`],
      aside: { label: "Withdraw →", href: subscribeHref(live.planId), tone: "warning" },
    };
  }
  if (live.status === "past_due") {
    const number = overdueInvoiceNumber(data);
    return {
      tone: "danger",
      pulse: true,
      title: `Past due${number ? ` · Direct invoice ${number}` : ""}`,
      details: ["Monitoring never pauses"],
      aside: { label: "View invoice in Billing →", href: INVOICES_HREF, tone: "danger" },
    };
  }
  if (live.status === "trialing") {
    return { tone: "primary", pulse: true, title: live.planName, details: ["Trial", `billing starts ${formatBillingDate(boundaryOf(live))}`], aside: manage };
  }
  return {
    tone: "success",
    pulse: false,
    title: live.planName,
    details: ["Active", ...(live.renewsAt ? [`Renews ${formatBillingDate(live.renewsAt)}`] : [])],
    aside: manage,
  };
}

function currentCard(option: PlanOption, live: Live): PricingCardState {
  const planId = option.id;
  const base = { planId, cta: disabled("Current plan"), footerLink: { label: "Manage billing →", href: BILLING_HREF } };

  if (live.cancelAtPeriodEnd) {
    return {
      planId,
      pill: { label: "Ending", tone: "warning" },
      cta: { kind: "link", label: `Resume ${option.name}`, href: subscribeHref(planId) },
      helper: `Ends ${formatBillingDate(live.currentPeriodEnd)}. Resume to keep this plan.`,
      footerLink: null,
    };
  }
  if (live.pendingPlan) {
    return {
      planId,
      pill: { label: "Current · change pending", tone: "neutral" },
      cta: { kind: "link", label: `Keep ${option.name}`, href: subscribeHref(planId) },
      helper: `Withdraws the scheduled move to ${live.pendingPlan.name} and keeps ${option.name}.`,
      footerLink: null,
    };
  }
  if (live.status === "past_due") {
    return {
      ...base,
      cta: disabled("Current plan (past due)", "danger"),
      pill: { label: "Past due", tone: "danger" },
      helper: "Direct invoice settlement window active.",
      footerLink: { label: "Resolve invoice in Billing →", href: INVOICES_HREF, tone: "danger" },
    };
  }
  if (live.status === "trialing") {
    return { ...base, pill: { label: "Current · trial", tone: "primary" }, helper: `Billing starts ${formatBillingDate(boundaryOf(live))}.` };
  }
  return {
    ...base,
    pill: { label: "Active plan", tone: "success" },
    helper: live.renewsAt ? `Renews ${formatBillingDate(live.renewsAt)}` : null,
  };
}

function ownerCard(option: PlanOption, data: BillingOverviewData, live: Live | null): PricingCardState {
  const planId = option.id;

  if (!option.selfServe) {
    return option.current
      ? { planId, pill: { label: "Current plan", tone: "primary" }, cta: disabled("Current plan"), helper: null, footerLink: { label: "Manage billing →", href: BILLING_HREF } }
      : emptyCard(planId);
  }
  if (live && option.current) return currentCard(option, live);
  if (live && option.pending) {
    return {
      planId,
      pill: { label: "Scheduled", tone: "warning" },
      cta: disabled(`Scheduled for ${formatBillingDate(live.currentPeriodEnd)}`, "warning"),
      helper: "Scheduled for the end of the period.",
      footerLink: null,
    };
  }
  if (option.unavailableReason) {
    return {
      planId,
      pill: null,
      cta: disabled(option.unavailableReason.replace(/\.$/, ""), "danger"),
      helper: `Remove members or invitations before moving to ${option.name}.`,
      footerLink: { label: "Manage members →", href: MEMBERS_HREF },
    };
  }

  const href = subscribeHref(planId);
  if (!live) {
    const trial = data.trial && !data.trial.expired && data.trial.endsAt ? data.trial : null;
    return {
      planId,
      pill: null,
      cta: { kind: "link", label: trial ? `Choose ${option.name}` : `Subscribe to ${option.name}`, href },
      helper: trial ? `Billing starts when your trial ends on ${formatBillingDate(trial.endsAt)}.` : "Starts now; the first invoice is issued today.",
      footerLink: null,
    };
  }
  if (live.status === "trialing") {
    return {
      planId,
      pill: null,
      cta: { kind: "link", label: `Choose ${option.name}`, href },
      helper: `Applies now; billing still starts when the trial ends on ${formatBillingDate(boundaryOf(live))}.`,
      footerLink: null,
    };
  }
  return option.effect === "period_end"
    ? {
        planId,
        pill: null,
        cta: { kind: "link", label: `Downgrade to ${option.name}`, href },
        helper: `Takes effect ${formatBillingDate(live.currentPeriodEnd)}`,
        footerLink: null,
      }
    : {
        planId,
        pill: null,
        cta: { kind: "link", label: `Upgrade to ${option.name}`, href },
        helper: "Applies now; the price difference for this period is invoiced.",
        footerLink: null,
      };
}

function memberCard(option: PlanOption): PricingCardState {
  if (!option.selfServe) return option.current ? { ...emptyCard(option.id), pill: { label: "Current plan", tone: "primary" }, cta: disabled("Current plan") } : emptyCard(option.id);
  return {
    planId: option.id,
    pill: option.current ? { label: "Current plan", tone: "primary" } : null,
    cta: disabled(option.current ? "Current plan" : `Choose ${option.name}`),
    helper: OWNER_ONLY_MESSAGE,
    footerLink: null,
  };
}

/** Who is looking and what each plan would do for them. `null` is a visitor without a session. */
export function resolvePricingViewer(data: BillingOverviewData | null): PricingViewer {
  if (!data) return anonymous();
  if (data.internal) return internal(data);

  const owner = data.canManage;
  const live = liveSubscription(data);
  const options = new Map(data.planOptions.map((option) => [option.id, option]));
  return {
    mode: owner ? "owner" : "member",
    strip: stripFor(data, live, owner),
    cards: allCards((planId) => {
      const option = options.get(planId);
      if (!option) return emptyCard(planId);
      return owner ? ownerCard(option, data, live) : memberCard(option);
    }),
  };
}
