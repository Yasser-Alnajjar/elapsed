import { addMonthsUtc, defaultSeatQuantity, INVOICE_NET_TERMS_DAYS, planPriceCents, prorateUpgradeCents, seatBounds } from "@sla/db";
import { PLANS, type LimitedResource, type PlanId } from "@sla/db/plans";
import { daysBetween, formatBillingDate, formatMoney, percentOf } from "@/lib/billing-format";
import type { SubscriptionActionInput } from "@/lib/billing-validation";
import type {
  SubscribeAlert,
  SubscribeBlock,
  SubscribeChange,
  SubscribeInvoice,
  SubscribeLimitRow,
  SubscribeReview,
} from "@/lib/types/billing-subscribe";
import type { BillingOverviewData, BillingTone, PlanOption, SubscriptionSummary } from "@/lib/types/billing";

/**
 * The Review & Subscribe screen's read model (N6.5). Given the billing
 * overview and the plan the person picked, it works out which of the five
 * supported subscription operations confirming would send (`start`,
 * `change_plan`, `resume`), what that does, when, and what is invoiced,
 * using the same rules the billing domain applies:
 *
 * - `planOptions` already decide "applies now" vs "at period end" and whether
 *   the seats in use block the plan (the domain refuses with `invalid_seats`).
 * - The upgrade proration is `prorateUpgradeCents`, the function the change
 *   itself calls, evaluated at the page's `asOf`; the amount charged is that
 *   at confirmation, so it is labelled an estimate.
 * - Invoices fall due `INVOICE_NET_TERMS_DAYS` after they are issued; a trial
 *   conversion or renewal is issued at the boundary date.
 * - Enterprise is priced by contract and is never confirmed here.
 *
 * Pure: no I/O, so every state is unit-tested.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MEMBERS_HREF = "/settings/members";

const LIMIT_ROWS: { id: string; resource: LimitedResource }[] = [
  { id: "seats", resource: "seats" },
  { id: "support-integrations", resource: "ticketSourceIntegrations" },
  { id: "engineering-integrations", resource: "engineeringIntegrations" },
  { id: "sla-policies", resource: "nativePolicies" },
];

const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
const monthly = (cents: number | null) => (cents === null ? "Custom" : `${formatMoney(cents)}/mo`);

/** The date a trial or period ends and the next charge falls. */
function boundaryOf(subscription: SubscriptionSummary): string {
  return subscription.status === "trialing" ? subscription.trialEndsAt ?? subscription.currentPeriodEnd : subscription.currentPeriodEnd;
}

function changeFor(option: PlanOption, live: SubscriptionSummary | null, trialEndsAt: string | null): SubscribeChange {
  if (!option.selfServe && !option.current) return "none";
  if (!live) return trialEndsAt ? "start_trial" : "start_now";
  if (option.current) return live.cancelAtPeriodEnd ? "resume" : live.pendingPlan ? "keep" : "none";
  if (option.pending) return "none";
  if (live.status === "trialing") return "change_trial";
  return option.effect === "period_end" ? "downgrade" : "upgrade";
}

function limitRows(data: BillingOverviewData, target: PlanId, licensedSeats: number | null): SubscribeLimitRow[] {
  const plan = PLANS[target];
  return LIMIT_ROWS.flatMap(({ id, resource }) => {
    const entitlement = data.entitlements.find((item) => item.id === id);
    if (!entitlement || entitlement.value.kind !== "quota") return [];
    const used = entitlement.value.used;
    const limit = resource === "seats" ? licensedSeats : plan.limits[resource];
    const percent = percentOf(used, limit);
    const over = limit !== null && used > limit;
    const tone: BillingTone = over ? (resource === "seats" ? "danger" : "warning") : percent >= 80 ? "warning" : "primary";
    const note =
      limit === null
        ? "No limit on this plan."
        : over
          ? resource === "seats"
            ? `${used} in use against ${limit} allowed.`
            : `${used - limit} over the limit. Existing ones keep working; adding more needs a higher plan.`
          : `${percent}% utilized · ${limit - used} remaining.${resource === "seats" && plan.limits.seats !== null && limit < plan.limits.seats ? ` Up to ${plan.limits.seats} on this plan.` : ""}`;
    return [{ id, label: entitlement.label, used, limit, percent, tone, note }];
  });
}

function cycleInvoice(plan: PlanId, seatsLicensed: number | null, dueAt: string | null, dueNote: string, followUp: string | null): SubscribeInvoice {
  const definition = PLANS[plan];
  const price = planPriceCents(plan);
  return {
    lines: [
      { label: `${definition.name} plan`, detail: "Monthly recurring fee", amountCents: price },
      ...(seatsLicensed === null
        ? []
        : [{ label: `Licensed seats (${seatsLicensed})`, detail: `Up to ${definition.limits.seats} on this plan`, amountCents: null }]),
    ],
    totalCents: price,
    estimated: false,
    currency: "USD",
    dueAt,
    dueNote,
    followUp,
  };
}

export function resolveSubscribeReview(data: BillingOverviewData, target: PlanId): SubscribeReview {
  const plan = PLANS[target];
  const name = plan.name;
  const priceCents = planPriceCents(target);
  const price = monthly(priceCents);
  const option = data.planOptions.find((item) => item.id === target);
  if (!option) throw new Error(`No plan option for ${target}`);

  const now = new Date(data.asOf);
  const live = data.subscription && data.subscription.status !== "cancelled" ? data.subscription : null;
  const trial = !live && data.trial && !data.trial.expired && data.trial.endsAt ? data.trial : null;
  const change = changeFor(option, live, trial?.endsAt ?? null);
  const from = live?.planName ?? null;
  const used = data.seats.used;
  const net = `${INVOICE_NET_TERMS_DAYS} days`;

  // ---- Why it cannot be confirmed, if it cannot ---------------------------------
  const pendingDate = live ? formatBillingDate(live.currentPeriodEnd) : "";
  let block: SubscribeBlock | null = null;
  if (data.internal) {
    block = { reason: "internal", title: "Internal organization", body: "Your organization is not billed, so there is no subscription to start or change." };
  } else if (!option.selfServe && !option.current) {
    block = { reason: "contact", title: "Priced by contract", body: `${name} cannot be self-served. Talk to us and we will set it up for your organization.` };
  } else if (!data.canManage) {
    block = {
      reason: "read_only",
      title: "Permission restricted",
      body: `Only an organization owner can subscribe or change plans. Ask an owner of ${data.organizationName} to make this change.`,
    };
  } else if (change === "none" && option.current) {
    block = { reason: "current", title: "Already on this plan", body: `Your organization is on ${name} with nothing scheduled.` };
  } else if (change === "none" && option.pending) {
    block = { reason: "scheduled", title: "Already scheduled", body: `The move to ${name} is already scheduled for ${pendingDate}.` };
  } else if (option.unavailableReason && change !== "keep" && change !== "resume") {
    block = {
      reason: "seats",
      title: "Seat allocation exceeded",
      body: `${option.unavailableReason} Remove members or pending invitations first.`,
    };
  }

  // ---- Seats on the target plan -------------------------------------------------
  const limit = plan.limits.seats;
  const licensedSeats =
    limit === null
      ? null
      : live
        ? option.current
          ? live.seatQuantity
          : Math.min(Math.max(live.seatQuantity, used), seatBounds(target, used).max)
        : defaultSeatQuantity(target, used);
  const seatsLine =
    licensedSeats === null
      ? `Unlimited seats (${used} in use)`
      : `${licensedSeats} licensed seats (${used} in use)${option.selfServe ? " · adjustable later in Billing" : ""}`;

  // ---- What confirming does -----------------------------------------------------
  const boundary = live ? boundaryOf(live) : trial?.endsAt ?? null;
  const renewal = live ? cycleInvoice(live.planId, live.seatQuantity, addDays(live.currentPeriodEnd, INVOICE_NET_TERMS_DAYS), `${net} after renewal`, null) : null;
  let action: SubscriptionActionInput | null = null;

  let heading = `Review ${name} plan`;
  let subheading = "Verify your plan entitlements and direct invoice schedule.";
  let statusPill: SubscribeReview["statusPill"] = { label: "Review", tone: "neutral" };
  let alert: SubscribeAlert | null = null;
  let transition = { from: from ?? "No plan", to: `${name} (${price})` };
  let effect = { headline: "Nothing to confirm", detail: "" };
  let invoice: SubscribeInvoice | null = null;
  let ctaLabel = `Confirm ${name}`;
  let success = { title: `Subscribed to ${name}`, message: "Saved and recorded in billing history.", effectiveLabel: "Effective", effectiveValue: "Today" };

  switch (change) {
    case "start_trial": {
      const endsAt = trial!.endsAt!;
      heading = `Review & Subscribe to ${name}`;
      subheading = "Verify your plan entitlements and direct invoice schedule before subscribing.";
      statusPill = { label: "Trial mode active", tone: "primary" };
      transition = { from: "Trial", to: `${name} (${price})` };
      effect = { headline: `Billing starts when your trial ends on ${formatBillingDate(endsAt)}`, detail: "No invoice is issued today. Your first invoice is issued when the trial ends." };
      invoice = cycleInvoice(target, licensedSeats, addDays(endsAt, INVOICE_NET_TERMS_DAYS), `${net} after trial`, null);
      ctaLabel = `Start ${name} subscription`;
      action = { action: "start", plan: target };
      success = { title: `Subscribed to ${name}`, message: "Saved and recorded in billing history. Your first invoice is issued when the trial ends.", effectiveLabel: "Billing starts", effectiveValue: formatBillingDate(endsAt) };
      break;
    }
    case "start_now": {
      const expired = data.trial?.expired ?? false;
      heading = `Subscribe to ${name}`;
      subheading = expired ? "Your trial has ended. Subscribing issues your first direct invoice today." : "Subscribing issues your first direct invoice today.";
      statusPill = data.subscription
        ? { label: "Subscription ended", tone: "warning" }
        : expired
          ? { label: "Trial ended", tone: "warning" }
          : { label: "No plan yet", tone: "neutral" };
      if (expired && data.trial?.endsAt) {
        alert = {
          tone: "warning",
          title: `Trial ended ${formatBillingDate(data.trial.endsAt)}`,
          body: "Monitoring and your data stay available. Subscribe to keep adding members, integrations and SLA policies.",
        };
      }
      transition = { from: data.subscription ? "Ended subscription" : expired ? "Expired trial" : "No plan", to: `${name} (${price})` };
      effect = { headline: "Starts now", detail: `The first invoice is issued today on net ${INVOICE_NET_TERMS_DAYS} terms.` };
      invoice = cycleInvoice(
        target,
        licensedSeats,
        addDays(data.asOf, INVOICE_NET_TERMS_DAYS),
        `${net} after issue`,
        priceCents === null ? null : `Renews ${formatBillingDate(addMonthsUtc(now, 1).toISOString())} at ${price}.`,
      );
      ctaLabel = `Subscribe to ${name}`;
      action = { action: "start", plan: target };
      success = { title: `Subscribed to ${name}`, message: "Saved and recorded in billing history. The first invoice is issued today.", effectiveLabel: "Starts", effectiveValue: "Today" };
      break;
    }
    case "change_trial": {
      const endsAt = boundary!;
      heading = `Switch to ${name}`;
      subheading = "Switching plans during a trial applies now, with no proration.";
      statusPill = { label: "Trial mode", tone: "primary" };
      transition = { from: `${from} (trial)`, to: `${name} (${price})` };
      effect = { headline: "Applies now (no proration during trial)", detail: `Your first invoice is issued when the trial ends on ${formatBillingDate(endsAt)}.` };
      invoice = cycleInvoice(target, licensedSeats, addDays(endsAt, INVOICE_NET_TERMS_DAYS), `${net} after trial`, null);
      ctaLabel = `Switch to ${name}`;
      action = { action: "change_plan", plan: target, expectedVersion: live!.version };
      success = { title: `Moved to ${name}`, message: "Saved and recorded in billing history.", effectiveLabel: "Effective", effectiveValue: "Today" };
      break;
    }
    case "upgrade": {
      const proration =
        live!.amountCents !== null && priceCents !== null
          ? Math.max(0, prorateUpgradeCents(live!.amountCents, priceCents, new Date(live!.currentPeriodStart), new Date(live!.currentPeriodEnd), now))
          : 0;
      const days = Math.max(0, daysBetween(data.asOf, live!.currentPeriodEnd));
      heading = `Upgrade to ${name}`;
      subheading = `Move from ${from} to ${name} now. The price difference for this period is invoiced.`;
      statusPill = live!.status === "past_due" ? { label: "Past due", tone: "danger" } : { label: `Currently on ${from}`, tone: "neutral" };
      transition = { from: `${from} (${monthly(live!.amountCents)})`, to: `${name} (${price})` };
      effect = { headline: "Applies now", detail: "Higher limits take effect as soon as you confirm." };
      invoice = {
        lines:
          proration > 0
            ? [{ label: `Upgrade to ${name}`, detail: `Prorated from ${from} for ${days} ${days === 1 ? "day" : "days"}`, amountCents: proration }]
            : [],
        totalCents: proration,
        estimated: true,
        currency: live!.currency,
        dueAt: proration > 0 ? addDays(data.asOf, INVOICE_NET_TERMS_DAYS) : null,
        dueNote: proration > 0 ? `${net} after issue` : "Nothing is invoiced now",
        followUp: live!.renewsAt ? `Then ${name} renews at ${price} on ${formatBillingDate(live!.renewsAt)}.` : null,
      };
      ctaLabel = `Upgrade to ${name}`;
      action = { action: "change_plan", plan: target, expectedVersion: live!.version };
      success = { title: `Moved to ${name}`, message: "Saved and recorded in billing history. The prorated difference is invoiced.", effectiveLabel: "Effective", effectiveValue: "Today" };
      break;
    }
    case "downgrade": {
      const endsAt = live!.currentPeriodEnd;
      heading = `Schedule downgrade to ${name}`;
      subheading = `Moves from ${from} to ${name} at the end of your billing period${limit === null ? "" : `, with ${limit} seats`}.`;
      statusPill = { label: "Downgrade schedule", tone: "warning" };
      alert = {
        tone: "warning",
        title: `Takes effect ${formatBillingDate(endsAt)} (end of period)`,
        body: `You stay on ${from} with its full features until then. You can withdraw this change at any time before it applies.`,
      };
      transition = { from: `${from} (${monthly(live!.amountCents)})`, to: `${name} (${price})` };
      effect = { headline: `Takes effect ${formatBillingDate(endsAt)}`, detail: "At the end of your current billing period." };
      invoice = cycleInvoice(target, licensedSeats, addDays(endsAt, INVOICE_NET_TERMS_DAYS), `${net} after renewal`, null);
      ctaLabel = `Schedule downgrade to ${name}`;
      action = { action: "change_plan", plan: target, expectedVersion: live!.version };
      success = { title: `Move to ${name} scheduled`, message: `Saved and recorded in billing history. You stay on ${from} until ${formatBillingDate(endsAt)}.`, effectiveLabel: "Takes effect", effectiveValue: formatBillingDate(endsAt) };
      break;
    }
    case "keep": {
      const pending = live!.pendingPlan!;
      heading = `Keep ${name}`;
      subheading = `A move to ${pending.name} is scheduled for ${pendingDate}. You can withdraw it now.`;
      statusPill = { label: "Downgrade pending", tone: "warning" };
      alert = { tone: "warning", title: `Scheduled to move to ${pending.name} on ${pendingDate}`, body: "Confirming cancels the scheduled change and keeps your current plan." };
      transition = { from: `Pending ${pending.name}`, to: `${name} (${price})` };
      effect = { headline: "Withdrawn immediately", detail: `Your subscription renews on ${name} on ${pendingDate}.` };
      invoice = renewal;
      ctaLabel = `Keep ${name}`;
      action = { action: "change_plan", plan: target, expectedVersion: live!.version };
      success = { title: `Staying on ${name}`, message: "Saved and recorded in billing history. The scheduled move was withdrawn.", effectiveLabel: "Renews", effectiveValue: pendingDate };
      break;
    }
    case "resume": {
      const endsAt = boundary!;
      heading = `Resume ${name}`;
      subheading = "Your subscription is scheduled to end. Resume it to keep it renewing.";
      statusPill = { label: "Cancellation pending", tone: "danger" };
      alert = { tone: "danger", title: `Subscription ends ${formatBillingDate(endsAt)}`, body: "Monitoring keeps running until then. Resuming withdraws the scheduled cancellation." };
      transition = { from: `Ending ${formatBillingDate(endsAt)}`, to: `${name} (${price})` };
      effect = { headline: "Resumes immediately", detail: `The scheduled cancellation is withdrawn and your subscription renews on ${formatBillingDate(endsAt)}.` };
      invoice = cycleInvoice(live!.planId, live!.seatQuantity, addDays(endsAt, INVOICE_NET_TERMS_DAYS), `${net} after renewal`, null);
      ctaLabel = `Resume ${name}`;
      action = { action: "resume", expectedVersion: live!.version };
      success = { title: "Subscription resumed", message: "Saved and recorded in billing history. The scheduled cancellation was withdrawn.", effectiveLabel: "Renews", effectiveValue: formatBillingDate(endsAt) };
      break;
    }
    case "none": {
      heading = `${name} plan`;
      subheading = plan.description;
      effect = { headline: "Nothing to confirm", detail: "" };
      if (live && option.current) {
        statusPill = { label: "Current plan", tone: "success" };
        effect = { headline: `Already active on ${name}`, detail: live.renewsAt ? `Next renewal on ${formatBillingDate(live.renewsAt)}.` : "" };
        invoice = renewal;
        transition = { from: `${name} (current)`, to: `${name} (current)` };
      } else if (priceCents === null) {
        invoice = { lines: [], totalCents: null, estimated: false, currency: "USD", dueAt: null, dueNote: "Invoiced per agreement terms", followUp: null };
        effect = { headline: "Provisioned by agreement", detail: "Set up with our team once terms are agreed." };
      }
      ctaLabel = priceCents === null ? "Talk to us" : option.current ? `Already on ${name}` : "Nothing to confirm";
      break;
    }
  }

  // ---- A block overrides the status, alert and button ---------------------------
  if (block) {
    action = null;
    switch (block.reason) {
      case "read_only":
        statusPill = { label: "Read-only access", tone: "neutral" };
        alert = { tone: "warning", title: block.title, body: block.body };
        effect = { headline: "Owner authorization required", detail: "Subscription changes must be made by an organization owner." };
        ctaLabel = "Owner approval required";
        break;
      case "seats": {
        const over = Math.max(0, used - (limit ?? used));
        statusPill = { label: "Action blocked", tone: "danger" };
        alert = { tone: "danger", title: block.title, body: block.body, link: { label: "Manage members in Organization →", href: MEMBERS_HREF } };
        effect = { headline: "Refused: seats exceed the plan limit", detail: `Remove ${over} ${over === 1 ? "seat" : "seats"} to continue.` };
        ctaLabel = "Remove members first";
        break;
      }
      case "internal":
        statusPill = { label: "Not billed", tone: "neutral" };
        alert = { tone: "info", title: block.title, body: block.body };
        invoice = null;
        effect = { headline: "No subscription", detail: "Internal organizations are not billed." };
        ctaLabel = "Not applicable";
        break;
      case "contact":
        statusPill = { label: "Custom contract", tone: "neutral" };
        alert = { tone: "info", title: block.title, body: block.body };
        heading = `${name} plan`;
        subheading = plan.description;
        ctaLabel = "Talk to us";
        break;
      case "scheduled":
        statusPill = { label: "Scheduled", tone: "warning" };
        alert = { tone: "warning", title: block.title, body: block.body };
        ctaLabel = `Scheduled for ${pendingDate}`;
        break;
      case "current":
        ctaLabel = `Already on ${name}`;
        break;
    }
  }

  return {
    planId: target,
    planName: name,
    planDescription: plan.description,
    priceCents,
    change,
    block,
    heading,
    subheading,
    statusPill,
    alert,
    transition,
    seatsLine,
    limits: limitRows(data, target, licensedSeats),
    effect,
    invoice,
    settlement: { label: `Direct invoice · Net ${INVOICE_NET_TERMS_DAYS}`, billingEmail: data.profile.billingEmail },
    cta: { label: ctaLabel, disabled: action === null },
    action,
    success,
  };
}
