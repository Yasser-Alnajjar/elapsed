import { IntegrationDetail } from "@modules/settings/integration-detail";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Integration settings");

export default async function IntegrationDetailPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  return <IntegrationDetail provider={provider} />;
}
