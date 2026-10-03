import type { PlanId } from "@sla/db/plans";
import type { BillingTone } from "@/lib/types/billing";

/**
 * What the public pricing page shows for the person looking at it: derived
 * from the billing read model (`BillingOverviewData`), never from the plan
 * constant alone, so every CTA matches what the billing domain would accept.
 */

export type PricingViewerMode = "anonymous" | "member" | "owner" | "internal";

/** The context strip under the hero: where this organization stands. */
export interface PricingContextStrip {
  tone: BillingTone;
  /** Pulses the dot: a live trial or a payment that needs attention. */
  pulse: boolean;
  /** Bold lead, e.g. "Trial" or "Team". */
  title: string;
  /** Muted segments after the title, joined by a separator. */
  details: string[];
  aside: { label: string; href?: string; tone?: BillingTone } | null;
}

export type PricingCta =
  /** A real navigation: sign up, the review page, or a mailto. */
  | { kind: "link"; label: string; href: string }
  /** A state the viewer cannot act on (current plan, scheduled, blocked, read-only). */
  | { kind: "disabled"; label: string; tone: BillingTone | null }
  /** Enterprise is priced by contract: the contact call to action. */
  | { kind: "contact" };

export interface PricingCardState {
  planId: PlanId;
  pill: { label: string; tone: BillingTone } | null;
  cta: PricingCta;
  /** One line under the button. */
  helper: string | null;
  /** A quiet follow-up link under the button: "Manage billing →". */
  footerLink: { label: string; href: string; tone?: BillingTone } | null;
}

export interface PricingViewer {
  mode: PricingViewerMode;
  strip: PricingContextStrip | null;
  cards: Record<PlanId, PricingCardState>;
}
