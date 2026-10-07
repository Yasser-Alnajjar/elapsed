import { ConciergeExport } from "@modules/internal/concierge-export";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Zendesk concierge export");

export default function ZendeskConciergeExportPage() {
  return <ConciergeExport provider="zendesk" />;
}
