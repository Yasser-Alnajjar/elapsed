import { Integrations } from "@modules/settings/integrations";
import { EntitlementBlockedNotice } from "@/components/shared/entitlement-alerts";

interface IntegrationsPageProps {
  searchParams: Promise<{ entitlement?: string; action?: string; provider?: string }>;
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const { entitlement, action, provider } = await searchParams;

  return (
    <>
      {/* A blocked connect (trial ended, D27) redirects here; say what was blocked, next to the page the owner tried to use. */}
      {entitlement === "trial_expired" && <EntitlementBlockedNotice action={action} provider={provider} />}
      <Integrations />
    </>
  );
}
