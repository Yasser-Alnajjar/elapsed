import { Overview } from "@modules/admin/overview";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Platform overview");

export default function AdminOverviewPage() {
  return <Overview />;
}
