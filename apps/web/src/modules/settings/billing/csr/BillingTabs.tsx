"use client";

import { CreditCard, LayoutGrid, ReceiptText, Info, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { BILLING_TAB_LABELS, BILLING_TABS, type BillingTab } from "@/lib/types/billing";
import { cn } from "@/lib/utils";

const TAB_ICONS: Record<BillingTab, LucideIcon> = {
  overview: LayoutGrid,
  invoices: ReceiptText,
  payment: CreditCard,
};

/** The segment switcher between the three billing tabs. Each tab is a URL (`?tab=`), so it can be linked to. */
export function BillingTabs({ active, providerAvailable }: { active: BillingTab; providerAvailable: boolean }) {
  return (
    <div className="border-border flex flex-col gap-2 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Billing sections" className="bg-card border-border flex max-w-full gap-1 overflow-x-auto rounded-lg border p-1">
        {BILLING_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const selected = tab === active;
          return (
            <Link
              key={tab}
              href={tab === "overview" ? "/billing" : `/billing?tab=${tab}`}
              scroll={false}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 font-mono text-xs whitespace-nowrap transition-colors",
                selected
                  ? "bg-surface-raised text-primary font-semibold shadow-sm"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon aria-hidden className={cn("size-3.5", !selected && "hidden sm:block")} />
              {BILLING_TAB_LABELS[tab]}
            </Link>
          );
        })}
      </nav>
      <span className="text-foreground-subtle hidden items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.06em] uppercase sm:flex">
        <Info aria-hidden className="text-primary size-3.5" />
        {providerAvailable ? "Payments by connected provider" : "Direct invoicing · no payment provider connected"}
      </span>
    </div>
  );
}
