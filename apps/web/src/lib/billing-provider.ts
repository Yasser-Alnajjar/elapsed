import type { BillingProvider } from "@sla/db";

/**
 * Selects the payment provider the billing domain talks to (N6.5, D28).
 *
 * None is integrated yet, so this returns null: the internal billing
 * lifecycle runs on its own and provider-only operations (payment methods,
 * the hosted portal, collecting a charge) report `provider_unavailable`.
 * Integrating one means writing an adapter that implements `BillingProvider`
 * and returning it here, typically when its credentials are configured.
 * Nothing else in the app names a provider.
 */
export function getBillingProvider(): BillingProvider | null {
  return null;
}
