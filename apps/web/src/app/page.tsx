import { Home } from "@modules/marketing/home";
import { getPageMetadata } from "@/lib/seo/metadata";

export const generateMetadata = () => getPageMetadata("/");

export default function HomePage() {
  return <Home />;
}
