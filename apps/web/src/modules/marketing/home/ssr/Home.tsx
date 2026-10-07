import { JsonLd } from "@/components/seo/json-ld";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { homeStructuredData } from "@/lib/seo/structured-data";
import { HOME_FAQS } from "../csr/home-content";
import { HomeView } from "../csr/HomeView";

/**
 * Reads the session directly (signed-in visitors are redirected to the
 * dashboard) so that lookup stays out of the "use client" view below.
 */
export const Home = async () => {
  return (
    <div className="flex min-h-screen flex-col">
      <JsonLd data={homeStructuredData(HOME_FAQS)} />
      <SiteHeader />
      <HomeView />
      <SiteFooter />
    </div>
  );
};
