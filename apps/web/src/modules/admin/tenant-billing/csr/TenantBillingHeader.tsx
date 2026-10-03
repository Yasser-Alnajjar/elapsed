"use client";

import { ArrowLeftRight, Check, Copy, FileDown, Gavel, MoreVertical } from "lucide-react";
import Link from "next/link";
import { AdminPanel, Tag } from "@/components/admin/admin-ui";
import { SubscriptionStatusPill } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import type { AdminTenantBillingDetail } from "@/lib/types/admin-billing";

interface TenantBillingHeaderProps {
  data: AdminTenantBillingDetail;
  busy: boolean;
  onChangePlan: () => void;
  onExportLedger: () => void;
  onReconcile: () => void;
}

function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xs">
      <span className="text-foreground-subtle text-[10px] font-semibold tracking-[0.06em] uppercase">{label}:</span>
      {children}
    </div>
  );
}

/** Who the tenant is (name, tier, state, keys), the header actions, and the operator protocol notice. */
export function TenantBillingHeader({ data, busy, onChangePlan, onExportLedger, onReconcile }: TenantBillingHeaderProps) {
  const { tenant } = data;
  const { copied, copy } = useCopyToClipboard();

  return (
    <AdminPanel className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">{tenant.name}</h1>
            <Tag tone="primary">{tenant.planLabel} tier</Tag>
            <SubscriptionStatusPill status={tenant.status} />
          </div>
          <p className="text-foreground-subtle text-sm">
            Billing inspection &amp; subscription lifecycle{tenant.ownerEmail && ` · owner ${tenant.ownerEmail}`}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Readout label="Tenant key">
              <span className="text-tertiary select-all">{tenant.id}</span>
              <button type="button" onClick={() => copy(tenant.id)} title="Copy tenant key" aria-label="Copy tenant key" className="text-foreground-subtle hover:text-foreground ml-1">
                {copied ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
              </button>
            </Readout>
            <Readout label="Billing account">
              <span className="text-primary select-all">{data.accountId ?? "none yet"}</span>
            </Readout>
            <Readout label="Operator notary">
              <span className="text-warning-text text-[10px] uppercase">Audit log on</span>
            </Readout>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="surface" size="compact" disabled={busy || !data.subscription || data.subscription.status === "cancelled"} onClick={onChangePlan} className="font-mono text-xs">
            <ArrowLeftRight aria-hidden className="text-tertiary size-4" />
            Change plan tier
          </Button>
          <Button type="button" variant="surface" size="compact" disabled={data.invoices.length === 0} onClick={onExportLedger} className="font-mono text-xs">
            <FileDown aria-hidden className="text-primary size-4" />
            Export full ledger
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="surface" size="compact" aria-label="More actions" className="px-2">
                <MoreVertical aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={busy} onSelect={onReconcile}>
                Reconcile now
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/admin/tenants/${tenant.id}`}>Open tenant record</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="bg-surface-container-lowest/60 flex items-center justify-between gap-4 rounded p-2.5">
        <p className="text-foreground-subtle flex items-start gap-2 font-mono text-[10px] leading-4">
          <Gavel aria-hidden className="text-tertiary size-4 shrink-0" />
          <span>
            <span className="text-muted-foreground font-semibold tracking-[0.06em] uppercase">Strict operator protocol: </span>
            Changes to subscription state, grace terms, or manual overrides require operator rationale and are recorded in the platform audit log.
          </span>
        </p>
        {data.subscription && <span className="text-foreground-subtle hidden shrink-0 font-mono text-[10px] xl:inline">VERSION: {data.subscription.version}</span>}
      </div>
    </AdminPanel>
  );
}
