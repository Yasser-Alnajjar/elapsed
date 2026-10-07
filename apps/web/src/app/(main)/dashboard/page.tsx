import { Dashboard } from "@modules/dashboard/dashboard";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Dashboard");

export default function DashboardPage() {
  return <Dashboard />;
}
