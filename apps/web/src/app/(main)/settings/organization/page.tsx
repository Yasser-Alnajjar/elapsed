import { Organization } from "@modules/settings/organization";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Organization");

export default function OrganizationPage() {
  return <Organization />;
}
