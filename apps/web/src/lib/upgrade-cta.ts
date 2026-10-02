/**
 * The one place that says how a customer asks to move to a paid plan (N6.4).
 *
 * There is no self-serve upgrade yet (N6.5, blocked on D28), so for now it is a
 * contact call to action. When the billing flow ships, return
 * `{ label: "Upgrade", href: "/upgrade" }` here and every banner, notice and
 * warning follows. Nothing else should hard-code a destination.
 *
 * Client-safe: `NEXT_PUBLIC_SUPPORT_EMAIL` is inlined at build time. With none
 * configured there is no link to offer, so the CTA is text only; no address is
 * invented.
 */
export interface UpgradeCta {
  label: string;
  /** Null when there is nowhere to send the customer; render the label as plain text. */
  href: string | null;
}

export function getUpgradeCta(): UpgradeCta {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  if (!email) return { label: "Contact Elapsed support to upgrade", href: null };
  return { label: "Contact us to upgrade", href: `mailto:${email}?subject=${encodeURIComponent("Upgrade my Elapsed plan")}` };
}
