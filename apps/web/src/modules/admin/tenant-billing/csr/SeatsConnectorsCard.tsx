import { CheckCircle2, RefreshCcwDot, Users } from "lucide-react";
import { MonoLabel, StatusDot } from "@/components/admin/admin-ui";
import { UsageBar } from "@/components/billing/billing-ui";
import { percentOf } from "@/lib/billing-format";
import type { AdminTenantBillingDetail } from "@/lib/types/admin-billing";
import { DetailCard } from "./detail-card";

/** Seat utilisation against the licensed seats, who holds them, and the integrations the tenant runs. */
export function SeatsConnectorsCard({ data }: { data: AdminTenantBillingDetail }) {
  const { seats } = data.tenant;
  const cap = seats.licensed ?? seats.planLimit;
  const percent = percentOf(seats.used, cap);
  const others = Math.max(0, data.memberCount - 1);

  return (
    <DetailCard
      icon={Users}
      iconClassName="text-tertiary"
      title="Seats & connectors"
      badge={
        <span className="text-foreground-subtle font-mono text-[10px]">
          {seats.used} / {cap ?? "∞"} SEATS
        </span>
      }
      footer={cap === null ? "Unlimited seats" : `${Math.max(0, cap - seats.used)} unallocated seats remaining`}
    >
      <div>
        <div className="mb-1 flex items-center justify-between font-mono text-[10px]">
          <MonoLabel>{seats.licensed !== null ? "Licensed utilization" : "Plan utilization"}</MonoLabel>
          <span className="text-primary font-bold">{cap === null ? "—" : `${percent}% capacity`}</span>
        </div>
        <UsageBar percent={percent} label="Seats in use" className="h-2 rounded" />
      </div>
      <ul className="flex flex-col gap-1">
        <li className="bg-surface-raised/50 flex items-center justify-between gap-2 rounded px-2 py-1 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusDot tone="success" className="size-2" />
            <span className="text-foreground truncate font-mono">{data.owner.name ?? data.owner.email ?? "No owner"}</span>
            <span className="text-tertiary font-mono text-[10px] uppercase">[Owner]</span>
          </span>
          <span className="text-foreground-subtle shrink-0 font-mono text-[10px]">Full admin</span>
        </li>
        {(others > 0 || data.pendingInvitations > 0) && (
          <li className="bg-surface-raised/50 flex items-center justify-between gap-2 rounded px-2 py-1 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <StatusDot tone="success" className="size-2" />
              <span className="text-foreground truncate font-mono">
                {others} member{others === 1 ? "" : "s"}
              </span>
            </span>
            <span className="text-foreground-subtle shrink-0 font-mono text-[10px]">+{data.pendingInvitations} invited</span>
          </li>
        )}
      </ul>
      <div>
        <MonoLabel className="mb-1.5 block">External integrations</MonoLabel>
        {data.connectors.length === 0 ? (
          <p className="text-foreground-subtle text-xs">Nothing connected.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5">
            {data.connectors.map((connector) => (
              <li key={connector.name} className="bg-surface-raised flex items-center justify-between gap-1 rounded p-2">
                <span className="flex min-w-0 items-center gap-1">
                  {connector.healthy ? <CheckCircle2 aria-hidden className="text-success size-3.5 shrink-0" /> : <RefreshCcwDot aria-hidden className="text-error size-3.5 shrink-0" />}
                  <span className="text-foreground truncate font-mono text-xs font-medium">{connector.name}</span>
                </span>
                <span className={`shrink-0 font-mono text-[10px] uppercase ${connector.healthy ? "text-success" : "text-error"}`}>{connector.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DetailCard>
  );
}
