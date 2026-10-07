import { Privacy } from "@modules/marketing/legal";
import { getPageMetadata } from "@/lib/seo/metadata";

export const generateMetadata = () => getPageMetadata("/privacy");

export default function PrivacyPage() {
  return <Privacy />;
}
