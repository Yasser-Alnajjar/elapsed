import { Terms } from "@modules/marketing/legal";
import { getPageMetadata } from "@/lib/seo/metadata";

export const generateMetadata = () => getPageMetadata("/terms");

export default function TermsPage() {
  return <Terms />;
}
