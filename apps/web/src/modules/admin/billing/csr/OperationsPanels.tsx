"use client";

import { AlertTriangle, Gauge, Network } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminPanel, StatusDot, Tag, ZeroState } from "@/components/admin/admin-ui";
import { UsageBar } from "@/components/billing/billing-ui";
import { formatCount, formatMoney, percentOf } from "@/lib/billing-format";
import type { Tone } from "@/lib/status-styles";
import type { AdminBillingOverviewData, DunningQueueItem } from "@/lib/types/admin-billing";

/** The three operations panels under the directory: overdue queue, ingest and collection, payment provider. */

function Panel({
  icon: Icon,
  iconClassName,
  title,
  badge,
  description,
  children,
  footer,
}: {
  icon: typeof Gauge;
  iconClassName: string;
  title: string;
  badge: ReactNode;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <AdminPanel className="flex flex-col justify-between gap-4 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-foreground flex items-center gap-2 font-mono text-base font-bold">
            <Icon aria-hidden className={`size-4.5 shrink-0 ${iconClassName}`} />
            {title}
          </h2>
          {badge}
        </div>
        <p className="text-muted-foreground text-xs leading-5">{description}</p>
        {children}
      </div>
      {footer}
    </AdminPanel>
  );
}

export function DunningQueuePanel({ queue, currency }: { queue: DunningQueueItem[]; currency: string }) {
  return (
    <Panel
      icon={AlertTriangle}
      iconClassName="text-error"
      title="Dunning Recovery Queue"
      badge={<Tag tone={queue.length > 0 ? "danger" : "success"}>{queue.length} actionable</Tag>}
      description="Invoices are due 14 days after issue. Overdue tenants are past due until an operator records payment, comps or extends grace. Monitoring is never paused."
      footer={<span className="text-foreground-subtle font-mono text-[10px]">Automated retries arrive with a payment provider.</span>}
    >
      {queue.length === 0 ? (
        <ZeroState title="Nothing is overdue">Every issued invoice is paid or still within its terms.</ZeroState>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {queue.map((item) => {
            const tone: Tone = item.overdueDays >= 7 ? "danger" : "warning";
            return (
              <li key={item.tenantId}>
                <Link
                  href={`/admin/billing/${item.tenantId}`}
                  className="bg-surface-raised hover:bg-surface-hover flex items-center justify-between gap-2 rounded p-2 font-mono text-[10px] transition-colors"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusDot tone={tone} />
                    <span className="text-foreground truncate font-bold">{item.tenantName}</span>
                  </span>
                  <span className={`shrink-0 font-bold ${tone === "danger" ? "text-error" : "text-warning-text"}`}>
                    {formatMoney(item.amountCents, currency)} · {item.overdueDays}d late
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function QuotaVelocityPanel({ totals, tenantCount }: { totals: AdminBillingOverviewData["totals"]; tenantCount: number }) {
  const collected = percentOf(totals.invoicesPaid90d, totals.invoicesIssued90d);
  return (
    <Panel
      icon={Gauge}
      iconClassName="text-primary"
      title="Cluster Quota Velocity"
      badge={<Tag tone="primary">Telemetry OK</Tag>}
      description={`Events ingested across ${tenantCount} tenants in the last 24 hours, and how much of the last 90 days' invoicing is collected. Events are not billed.`}
      footer={
        <div className="text-muted-foreground flex items-center justify-between font-mono text-[10px]">
          <span>Billing reconciles on every read</span>
          <span className="text-primary">{formatCount(totals.events24h)} events / 24h</span>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 flex justify-between font-mono text-[10px]">
            <span className="text-foreground-subtle">Ingress events (24h)</span>
            <span className="text-foreground font-bold">{formatCount(totals.events24h)}</span>
          </div>
          <UsageBar percent={totals.events24h > 0 ? 100 : 0} label="Events ingested in the last 24 hours" className="h-2 rounded opacity-60" />
        </div>
        <div>
          <div className="mb-1 flex justify-between font-mono text-[10px]">
            <span className="text-foreground-subtle">
              Invoices collected (90d: {totals.invoicesPaid90d} / {totals.invoicesIssued90d})
            </span>
            <span className="text-success font-bold">{totals.invoicesIssued90d === 0 ? "—" : `${collected}%`}</span>
          </div>
          <UsageBar percent={collected} tone="success" label="Invoices collected in the last 90 days" className="h-2 rounded" />
        </div>
      </div>
    </Panel>
  );
}

export function GatewayStatusPanel({ providerAvailable, totals, currency }: { providerAvailable: boolean; totals: AdminBillingOverviewData["totals"]; currency: string }) {
  return (
    <Panel
      icon={Network}
      iconClassName="text-tertiary"
      title="Gateway Link Status"
      badge={<Tag tone={providerAvailable ? "success" : "neutral"}>{providerAvailable ? "Connected" : "Internal only"}</Tag>}
      description="The internal billing ledger is the source of truth. A payment provider, once connected, mirrors subscriptions and collects charges."
      footer={
        <div className="flex items-center justify-between font-mono text-[10px]">
          <span className="text-foreground-subtle">Open balance</span>
          <span className="text-foreground font-bold tabular-nums">{formatMoney(totals.openCents, currency)}</span>
        </div>
      }
    >
      <ul className="flex flex-col gap-2 font-mono text-[10px]">
        <li className="bg-surface-raised flex items-center justify-between gap-2 rounded p-2">
          <span className="flex items-center gap-2">
            <StatusDot tone="success" className="size-2" />
            <span className="text-foreground font-bold">Internal billing ledger</span>
          </span>
          <span className="text-muted-foreground shrink-0">ACTIVE</span>
        </li>
        <li className="bg-surface-raised flex items-center justify-between gap-2 rounded p-2">
          <span className="flex items-center gap-2">
            <StatusDot tone={providerAvailable ? "success" : "neutral"} className="size-2" />
            <span className="text-foreground font-bold">Payment provider</span>
          </span>
          <span className="text-muted-foreground shrink-0">{providerAvailable ? "CONNECTED" : "NOT CONNECTED"}</span>
        </li>
      </ul>
    </Panel>
  );
}
