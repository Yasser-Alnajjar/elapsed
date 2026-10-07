import { BillingOverview } from "@modules/admin/billing";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Platform billing");

export default function AdminBillingPage() {
  return <BillingOverview />;
}
