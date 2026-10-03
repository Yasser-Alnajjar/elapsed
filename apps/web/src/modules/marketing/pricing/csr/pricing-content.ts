import { formatPlanPrice, PLAN_LIST, planFeatureLines, TRIAL_LENGTH_DAYS } from "@sla/db/plans";
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
