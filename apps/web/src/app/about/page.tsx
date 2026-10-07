import { About } from "@modules/marketing/about";
import { getPageMetadata } from "@/lib/seo/metadata";

export const generateMetadata = () => getPageMetadata("/about");

export default function AboutPage() {
  return <About />;
}
