import { ReviewSubscribe } from "@modules/settings/billing";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Subscribe");

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  return <ReviewSubscribe plan={plan} />;
}
