import { AdminActions } from "@/actions/admin";
import { TenantsView } from "../csr/TenantsView";

export const Tenants = async ({ query }: { query: string }) => {
  const data = await AdminActions.getTenants();

  // Keyed by the query so a new search from the top bar resets the list controls.
  return <TenantsView key={query} data={data} initialQuery={query} />;
};
