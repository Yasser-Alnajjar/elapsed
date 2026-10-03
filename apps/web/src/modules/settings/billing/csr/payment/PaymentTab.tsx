import type { ReactNode } from "react";
import type { BillingOverviewData } from "@/lib/types/billing";
import { BillingPageHeader } from "../BillingPageHeader";
import { BillingProfileCards } from "./BillingProfileCards";
import { BillingSecurityBanner } from "./BillingSecurityBanner";
import { PaymentMethodPanel } from "./PaymentMethodPanel";

/** "Payment Details & Tax ID": the payment source, then the legal and tax profile invoices are issued against. */
export function PaymentTab({ data, tabs, onEditProfile }: { data: BillingOverviewData; tabs: ReactNode; onEditProfile: () => void }) {
  return (
    <>
      <BillingPageHeader
        crumb="Payment Details"
        title="Payment Details & Tax ID"
        description={
          <>
            The payment source, legal entity and tax identity invoices are issued against for{" "}
            <span className="text-foreground font-medium">{data.organizationName}</span>.
          </>
        }
      />
      {tabs}
      <PaymentMethodPanel data={data} onEditProfile={onEditProfile} />
      <BillingProfileCards profile={data.profile} onEdit={onEditProfile} />
      <BillingSecurityBanner providerAvailable={data.providerAvailable} />
    </>
  );
}
