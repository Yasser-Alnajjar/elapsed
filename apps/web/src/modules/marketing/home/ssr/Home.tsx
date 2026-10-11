import { JsonLd } from "@/components/seo/json-ld";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { getReleaseStages } from "@/lib/release-stage-data";
import { homeStructuredData } from "@/lib/seo/structured-data";
import { HOME_FAQS } from "../csr/home-content";
import { HomeView } from "../csr/HomeView";

/**
 * Reads the session directly (signed-in visitors are redirected to the
 * dashboard) so that lookup stays out of the "use client" view below. Also
 * reads each integration's release stage, so the page must render per request
 * (`app/page.tsx`).
 */
export const Home = async () => {
  const releaseStages = await getReleaseStages();
  return (
    <div className="flex min-h-screen flex-col">
      <JsonLd data={homeStructuredData(HOME_FAQS)} />
      <SiteHeader />
      <HomeView releaseStages={releaseStages} />
      <SiteFooter />
    </div>
  );
};
