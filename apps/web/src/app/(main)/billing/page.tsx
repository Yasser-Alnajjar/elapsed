import { Billing } from "@modules/settings/billing";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return <Billing tab={tab} />;
}
