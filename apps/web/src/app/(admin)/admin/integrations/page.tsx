import { Integrations } from "@modules/admin/integrations";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Integrations");

export default function AdminIntegrationsPage() {
  return <Integrations />;
}
