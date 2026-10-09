import { AdminActions } from "@/actions/admin";
import { IntegrationsView } from "../csr/IntegrationsView";

export const Integrations = async () => {
  // Operator-only: `getIntegrations` calls `notFound()` for anyone else before anything is read.
  const data = await AdminActions.getIntegrations();
  return <IntegrationsView initialData={data} />;
};
