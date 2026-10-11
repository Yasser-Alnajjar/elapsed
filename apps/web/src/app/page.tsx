import { Home } from "@modules/marketing/home";
import { getPageMetadata } from "@/lib/seo/metadata";

// The integration release stages on this page come from the persisted policy
// (D33), so the page renders per request instead of freezing them at build.
export const dynamic = "force-dynamic";

export const generateMetadata = () => getPageMetadata("/");

export default function HomePage() {
  return <Home />;
}
