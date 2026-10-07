import { SlaConfiguration } from "@modules/settings/sla-configuration";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("SLA configuration");

export default function SlaConfigurationPage() {
  return <SlaConfiguration />;
}
