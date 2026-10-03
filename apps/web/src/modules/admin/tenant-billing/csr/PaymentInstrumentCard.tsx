import { FileText, Wallet } from "lucide-react";
import { Tag } from "@/components/admin/admin-ui";
import { BillingFactRow } from "@/components/billing/billing-ui";
import type { AdminTenantBillingDetail } from "@/lib/types/admin-billing";
import { DetailCard } from "./detail-card";

/** How this tenant pays. Payment instruments live with a payment provider; until one is connected, settlement is by direct invoice. */
export function PaymentInstrumentCard({ data, onRequestUpdate }: { data: AdminTenantBillingDetail; onRequestUpdate: () => void }) {
  const { profile } = data;
  return (
    <DetailCard
      icon={Wallet}
      iconClassName="text-primary"
      title="Payment instrument"
      badge={<Tag tone={data.providerAvailable ? "success" : "neutral"}>{data.providerAvailable ? "Provider" : "Direct invoice"}</Tag>}
      footer={data.providerAvailable ? "Instruments are held by the payment provider" : "No payment provider connected"}
      action={{ label: "Request card update", onClick: onRequestUpdate }}
    >
      <div className="bg-surface-raised flex flex-col gap-2 rounded-xl p-4">
        <span className="text-foreground flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest uppercase">
          <FileText aria-hidden className="text-primary size-4" />
          Invoice · net 14
        </span>
        <p className="text-muted-foreground text-xs leading-5">Invoices are emailed to the billing contact and recorded as paid by an operator when payment arrives.</p>
      </div>
      <dl className="flex flex-col gap-1">
        <BillingFactRow label="Billing contact">{profile.billingEmail ?? "Not set"}</BillingFactRow>
        <BillingFactRow label="Legal entity">{profile.legalName ?? "Not set"}</BillingFactRow>
        <BillingFactRow label="Tax ID">{profile.taxId ?? "Not set"}</BillingFactRow>
      </dl>
    </DetailCard>
  );
}
