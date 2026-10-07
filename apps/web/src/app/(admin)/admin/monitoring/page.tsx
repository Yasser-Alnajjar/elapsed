import { Monitoring } from "@modules/admin/monitoring";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Monitoring");

export default function AdminMonitoringPage() {
  return <Monitoring />;
}
