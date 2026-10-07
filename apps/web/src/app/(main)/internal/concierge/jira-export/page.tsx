import { ConciergeExport } from "@modules/internal/concierge-export";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Jira concierge export");

export default function JiraConciergeExportPage() {
  return <ConciergeExport provider="jira" />;
}
