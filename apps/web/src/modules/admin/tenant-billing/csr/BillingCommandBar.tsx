import { Building2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { StatusDot } from "@/components/admin/admin-ui";
import type { AdminBillingTenantRow } from "@/lib/types/admin-billing";

const STATE: Record<AdminBillingTenantRow["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "Current", tone: "success" },
  trialing: { label: "Trialing", tone: "warning" },
  past_due: { label: "Delinquent", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  internal: { label: "Internal", tone: "neutral" },
};

const STATE_TEXT = { success: "text-success", warning: "text-warning-text", danger: "text-error", neutral: "text-muted-foreground" } as const;

/** Breadcrumb back to the directory, then the ledger and billing-state pills. */
export function BillingCommandBar({ tenant }: { tenant: AdminBillingTenantRow }) {
  const state = STATE[tenant.status];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav aria-label="Breadcrumb" className="text-foreground-subtle flex flex-wrap items-center gap-1.5 font-mono text-xs">
        <Link href="/admin/billing" className="hover:text-primary flex items-center gap-1 transition-colors">
          <Building2 aria-hidden className="size-4" />
          Billing operations
        </Link>
        <span className="text-border-strong">/</span>
        <span className="bg-surface-raised text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">{tenant.id}</span>
        <span className="text-border-strong">/</span>
        <span className="text-primary font-medium" aria-current="page">
          Billing &amp; subscription lifecycle
        </span>
      </nav>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase">
        <span className="bg-surface-raised flex items-center gap-1.5 rounded px-2.5 py-1">
          <ShieldCheck aria-hidden className="text-primary size-3.5" />
          <span className="text-muted-foreground">Ledger: internal · reconciled</span>
        </span>
        <span className="bg-surface-raised flex items-center gap-1.5 rounded px-2.5 py-1">
          <StatusDot tone={state.tone} pulse={state.tone === "danger"} />
          <span className={`font-bold ${STATE_TEXT[state.tone]}`}>State: {state.label}</span>
        </span>
      </div>
    </div>
  );
}
