import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { PrivacyView } from "../csr/PrivacyView";

export const Privacy = async () => {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <PrivacyView />
      <SiteFooter />
    </div>
  );
};
