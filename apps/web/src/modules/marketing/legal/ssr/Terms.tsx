import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { TermsView } from "../csr/TermsView";

export const Terms = async () => {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <TermsView />
      <SiteFooter />
    </div>
  );
};
