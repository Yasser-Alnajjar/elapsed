import { ReviewSubscribe } from "@modules/settings/billing";

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  return <ReviewSubscribe plan={plan} />;
}
