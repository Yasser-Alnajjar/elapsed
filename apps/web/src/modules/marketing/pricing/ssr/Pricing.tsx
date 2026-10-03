import { Actions } from "@/actions";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { resolvePricingViewer } from "@/lib/pricing-viewer";
import { PricingView } from "../csr/PricingView";

export const Pricing = async () => {
  // Public page: a visitor has no billing data, a signed-in person sees their own organization's state.
  const data = await Actions.Billing.getDataIfSignedIn();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <PricingView viewer={resolvePricingViewer(data)} />
      <SiteFooter />
    </div>
  );
};
