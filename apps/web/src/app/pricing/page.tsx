import { Pricing } from "@modules/marketing/pricing";
import { getPageMetadata } from "@/lib/seo/metadata";

export const generateMetadata = () => getPageMetadata("/pricing");

export default function PricingPage() {
  return <Pricing />;
}
