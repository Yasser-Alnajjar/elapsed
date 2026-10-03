/**
 * The boundary between the billing domain (`./billing.ts`) and an external
 * payment provider (N6.5, D28). Nothing in the domain knows which provider is
 * behind this, or whether there is one: with none configured the caller
 * passes `null`, internal transitions still happen, and the operations that
 * genuinely need a provider fail with `provider_unavailable`.
 *
 * A provider adapter (`StripeBillingProvider`, ...) implements this interface
 * outside the domain and is selected in `apps/web/src/lib/billing-provider.ts`.
 * Each method maps to something the billing UI does today; nothing here is
 * speculative.
 */

/** What the provider needs to mirror after a committed subscription change. */
export interface SubscriptionSnapshot {
  organizationId: string;
  plan: string;
  status: "trial" | "active" | "past_due" | "cancelled";
  seatQuantity: number;
  unitPriceCents: number | null;
  currency: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: string | null;
}

export interface BillingProvider {
  /** Provider name for display and logs, e.g. "Stripe". */
  readonly name: string;

  /**
   * Mirrors an internal transition (start, plan or seat change, cancel,
   * resume) on the provider. Called inside the domain's transaction, so a
   * provider failure rolls the internal change back.
   */
  syncSubscription(snapshot: SubscriptionSnapshot): Promise<void>;

  /** A hosted page where the customer adds or replaces a payment method. */
  createPaymentMethodSession(input: { organizationId: string; billingEmail: string | null; returnUrl: string }): Promise<{ url: string }>;

  /** The provider's self-service portal: receipts, invoice PDFs, payment methods. */
  createPortalSession(input: { organizationId: string; returnUrl: string }): Promise<{ url: string }>;

  /** Tries to collect one open invoice now (an operator's "retry charge"). */
  collectInvoice(input: { organizationId: string; invoiceNumber: string; amountCents: number; currency: string }): Promise<{ paid: boolean; failureCode?: string }>;
}
