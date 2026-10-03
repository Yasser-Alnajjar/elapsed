import { formatPlanPrice, LIMITED_RESOURCES, PLAN_LIST, planFeatureLines, RESOURCE_LABELS, TRIAL_LENGTH_DAYS } from "@sla/db/plans";
import type { PlanId } from "@sla/db/plans";
import type { PricingFaq, PricingPlan } from "@/lib/types/marketing";

// Rendered from the one plan constant that entitlement checks also read (N6.1),
// so the public page and what is enforced cannot drift apart.
export const PLANS: PricingPlan[] = PLAN_LIST.map((plan) => ({
  id: plan.id,
  name: plan.name,
  ...formatPlanPrice(plan),
  description: plan.description,
  highlighted: plan.highlighted,
  features: planFeatureLines(plan),
}));

// Wording matches what the billing domain does (`packages/db/src/billing.ts`):
// direct net-14 invoices, upgrades prorated now, downgrades at period end,
// cancellation at period end, owners only.
export const FAQS: PricingFaq[] = [
  {
    question: "How does billing work?",
    answer: `Subscriptions are billed monthly in USD, with no credit card required. Invoices are issued directly to your organization on net-14 terms. A new organization starts with a ${TRIAL_LENGTH_DAYS}-day trial; when it ends, or when you subscribe afterwards, your first invoice is issued and appears in your Billing page. You can cancel at any time and the cancellation takes effect at the end of the current billing period.`,
  },
  {
    question: "What happens if we exceed integration or policy limits?",
    answer:
      "Nothing is switched off. Limits only apply where you add something new: inviting a member, connecting an integration or creating an SLA policy. Ingestion, handoff calculations, alerts and your historical proof chain keep running uninterrupted.",
  },
  {
    question: "Do policies imported from Zendesk count toward the limit?",
    answer: "No. Policies imported from Zendesk never count toward the SLA policy limit. Only policies created in Elapsed do.",
  },
  {
    question: "How do plan upgrades and downgrades take effect?",
    answer:
      "Upgrades apply immediately, and the price difference for the rest of your billing period is added as an invoice. Downgrades stay scheduled until the end of the current period. If more seats are in use than the target plan allows, you need to remove members or invitations before the change can be made. During a trial, a plan change applies now with no proration.",
  },
  {
    question: "Who in our company can change billing?",
    answer:
      "Only an organization owner can subscribe, change plans, or cancel. Members can see the current plan and entitlements, and read invoices, but cannot change them.",
  },
];

const limitLabel = (resource: (typeof LIMITED_RESOURCES)[number]) => {
  const label = RESOURCE_LABELS[resource];
  return resource === "nativePolicies" ? "SLA policies created in Elapsed" : label.charAt(0).toUpperCase() + label.slice(1);
};

/** The compare table: every value read from the same plan limits entitlement checks enforce. */
export const COMPARE_SECTIONS: { title: string; rows: { label: string; values: Record<PlanId, string> }[] }[] = [
  {
    title: "Limits",
    rows: LIMITED_RESOURCES.map((resource) => ({
      label: limitLabel(resource),
      values: Object.fromEntries(PLAN_LIST.map((plan) => [plan.id, plan.limits[resource] === null ? "Unlimited" : String(plan.limits[resource])])) as Record<PlanId, string>,
    })),
  },
  {
    title: "Billing",
    rows: [
      {
        label: "Price",
        values: Object.fromEntries(PLAN_LIST.map((plan) => [plan.id, plan.monthlyPriceUsd === null ? "Contract" : `$${plan.monthlyPriceUsd}/mo`])) as Record<PlanId, string>,
      },
    ],
  },
];

export const INCLUDED_IN_EVERY_PLAN: { title: string; description: string }[] = [
  { title: "Read-only integrations", description: "We never create or change your tickets, issues, or repositories." },
  { title: "Deterministic case correlation", description: "Cases are linked from verified cross-system references, never guessed." },
  { title: "Business-hours and 24/7 calendars with holidays", description: "Working time follows your calendar; holidays contribute zero working minutes." },
  { title: "Case timeline with \u2018How this was calculated\u2019", description: "The policy, calendar, pauses, and thresholds behind every number." },
  { title: "Dashboard and At risk now table", description: "What is breaching, at risk, and aging in engineering, in one view." },
  { title: "CSV exports", description: "Take what is on screen into a QBR or an audit." },
  { title: "Encrypted credentials (AES-256-GCM)", description: "Integration secrets are encrypted at rest before they reach the database." },
  { title: `${TRIAL_LENGTH_DAYS}-day trial with full access`, description: "No credit card required to start." },
];

// Same facts as the billing FAQ above, as a reference list.
export const BILLING_DETAILS: { term: string; detail: string }[] = [
  { term: "Currency & cadence", detail: "Billed monthly in USD." },
  { term: "Invoices", detail: "Issued directly to your organization on net-14 terms." },
  { term: "Upgrades", detail: "Apply immediately; the difference for the rest of the period is invoiced." },
  { term: "Downgrades", detail: "Take effect at the end of the current period." },
  { term: "Cancellation", detail: "Any time; takes effect at the end of the current period." },
  { term: "Who can change billing", detail: "Organization owners only. Members can view the plan and invoices." },
];
