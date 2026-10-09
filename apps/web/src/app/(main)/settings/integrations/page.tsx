import { Integrations } from "@modules/settings/integrations";
import { EntitlementBlockedNotice } from "@/components/shared/entitlement-alerts";
import { IntegrationUnavailableNotice } from "@/components/shared/integration-availability-notice";
import { noIndexMetadata } from "@/lib/seo/metadata";

interface IntegrationsPageProps {
  searchParams: Promise<{ entitlement?: string; action?: string; provider?: string; availability?: string }>;
}

export const metadata = noIndexMetadata("Integrations");

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const { entitlement, action, provider, availability } = await searchParams;

  return (
    <>
      {/* A blocked connect (trial ended, D27) redirects here; say what was blocked, next to the page the owner tried to use. */}
      {entitlement === "trial_expired" && <EntitlementBlockedNotice action={action} provider={provider} />}
      {/* A refused connect for an unavailable provider (D33) redirects here with the reason. */}
      {availability && <IntegrationUnavailableNotice code={availability} provider={provider} />}
      <Integrations />
    </>
  );
}
