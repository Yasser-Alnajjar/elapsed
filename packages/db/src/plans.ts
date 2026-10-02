/**
 * The plans Elapsed sells, defined once (N6.1, decision D14: Starter $49, Team
 * $149, Enterprise custom, seat-based). The public pricing page renders from
 * this constant and entitlement checks read the same limits, so what is
 * advertised and what is enforced cannot drift (`plans.test.ts`).
 *
 * Pure data and pure functions: no Prisma, no I/O. It is exported on its own
 * (`@sla/db/plans`) so the client-rendered pricing page can import it without
 * pulling in the database client. The obsolete `$299/$699` pilot pricing and
 * the escalation-volume model of `plans/03` Phase 18 are not adopted and must
 * not be added here.
 */

/** Length of the trial every new organization starts with, as the pricing page says. */
export const TRIAL_LENGTH_DAYS = 14;

export const PLAN_IDS = ["starter", "team", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/**
 * What a plan allows. `null` is unlimited. Limits are measured only at the
 * three creation points (invite, connect, create native policy); nothing here
 * ever gates evaluation, notifications, sync or existing data.
 */
export interface PlanLimits {
  /** Members plus pending invitations. */
  seats: number | null;
  /** Connected integrations whose role is `ticket_source`. */
  ticketSourceIntegrations: number | null;
  /** Connected integrations whose role is `work_tracker` or `code_host`. */
  engineeringIntegrations: number | null;
  /** Policies created natively in Elapsed. Imported policies never count (D25). */
  nativePolicies: number | null;
}

export type LimitedResource = keyof PlanLimits;

export const LIMITED_RESOURCES = ["seats", "ticketSourceIntegrations", "engineeringIntegrations", "nativePolicies"] as const satisfies readonly LimitedResource[];

export const RESOURCE_LABELS: Record<LimitedResource, string> = {
  seats: "seats",
  ticketSourceIntegrations: "support integrations",
  engineeringIntegrations: "engineering integrations",
  nativePolicies: "SLA policies",
};

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Monthly list price in USD, or null for "Custom". Informational: no billing code reads it yet (N6.5). */
  monthlyPriceUsd: number | null;
  description: string;
  cta: string;
  highlighted: boolean;
  limits: PlanLimits;
  /** Feature lines the limits do not already express. Each must describe something built. */
  extraFeatures: string[];
  /** Lines that stand in for a limit when its wording is more specific than the generic one. */
  integrationsLine: string;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Starter",
    monthlyPriceUsd: 49,
    description: "For a single support team getting SLA visibility for the first time.",
    cta: "Get started",
    highlighted: false,
    limits: { seats: 5, ticketSourceIntegrations: 1, engineeringIntegrations: 1, nativePolicies: 3 },
    integrationsLine: "1 support integration (Zendesk or Intercom) and 1 engineering integration",
    extraFeatures: ["Email alerts on at-risk cases"],
  },
  team: {
    id: "team",
    name: "Team",
    monthlyPriceUsd: 149,
    description: "For teams handing cases between support and engineering every day.",
    cta: "Get started",
    highlighted: true,
    limits: { seats: 20, ticketSourceIntegrations: null, engineeringIntegrations: null, nativePolicies: null },
    integrationsLine: "Unlimited integrations (Zendesk, Jira, Linear, Intercom, GitHub)",
    extraFeatures: ["Slack notifications before breach", "Full case correlation across engineering"],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    monthlyPriceUsd: null,
    description: "For organizations with multiple teams, regions, or compliance needs.",
    cta: "Talk to us",
    highlighted: false,
    limits: { seats: null, ticketSourceIntegrations: null, engineeringIntegrations: null, nativePolicies: null },
    integrationsLine: "Unlimited integrations",
    extraFeatures: ["Dedicated onboarding support on request"],
  },
};

export const PLAN_LIST: PlanDefinition[] = PLAN_IDS.map((id) => PLANS[id]);

export function formatPlanPrice(plan: PlanDefinition): { price: string; cadence: string } {
  return plan.monthlyPriceUsd === null
    ? { price: "Custom", cadence: "" }
    : { price: `$${plan.monthlyPriceUsd}`, cadence: "/month" };
}

/** The bullet list the pricing page shows, derived from the limits so a changed limit changes the page. */
export function planFeatureLines(plan: PlanDefinition): string[] {
  const { limits } = plan;
  const lines: string[] = [];
  if (plan.id === "enterprise") lines.push("Everything in Team");
  lines.push(plan.integrationsLine);
  lines.push(limits.nativePolicies === null ? "Unlimited SLA policies and calendars" : `Up to ${limits.nativePolicies} SLA policies`);
  lines.push(limits.seats === null ? "Unlimited seats" : `${limits.seats} seats`);
  lines.push(...plan.extraFeatures);
  return lines;
}
