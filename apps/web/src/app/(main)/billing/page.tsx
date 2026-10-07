import { Billing } from "@modules/settings/billing";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Billing & usage");

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return <Billing tab={tab} />;
}
