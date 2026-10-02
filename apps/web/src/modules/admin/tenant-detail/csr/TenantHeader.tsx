import { History, RefreshCw } from "lucide-react";
import Link from "next/link";
import { AdminPanel, Tag } from "@/components/admin/admin-ui";
import {
  HealthBadge,
  PlanChip,
  PlanStatusBadge,
} from "@/components/admin/tenant-badges";
import { Button } from "@/components/ui/button";
import { formatUtcClock, formatUtcTimestamp } from "@/lib/admin-format";
import type { AdminTenantRow } from "@/lib/types/admin";

interface TenantHeaderProps {
  tenant: AdminTenantRow;
  asOf: string;
  refreshing: boolean;
  onRefresh: () => void;
}

/** Who this tenant is: name, id, health, plan, owner, members, and the two things you may want next (refresh, its audit trail). */
export function TenantHeader({
  tenant,
  asOf,
  refreshing,
  onRefresh,
}: TenantHeaderProps) {
  return (
    <AdminPanel className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">
            {tenant.name}
          </h1>
          <Tag
            tone="primary"
            title="Organization id"
            className="px-2 py-1 text-xxs normal-case"
          >
            {tenant.organizationId}
          </Tag>
          <HealthBadge health={tenant.health} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PlanChip plan={tenant.plan} />
          <PlanStatusBadge status={tenant.planStatus} />
        </div>

        <dl className="text-muted-foreground mt-4 flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-xs">
          <div className="flex gap-1.5">
            <dt className="text-foreground-subtle">Owner</dt>
            <dd className="text-foreground">
              {tenant.ownerEmail ?? "No owner"}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-foreground-subtle">Members</dt>
            <dd className="text-foreground">
              {tenant.memberCount}
              {tenant.pendingInvitations > 0 && (
                <span className="text-foreground-subtle">
                  {" "}
                  (+{tenant.pendingInvitations} invited)
                </span>
              )}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-foreground-subtle">Created</dt>
            <dd className="text-foreground">
              {formatUtcTimestamp(tenant.createdAt)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
        <Button
          type="button"
          variant="surface"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          className="justify-between font-mono text-xs"
        >
          <span className="flex items-center gap-2">
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            Refresh snapshot
          </span>
          <span className="text-foreground-subtle tabular-nums">
            {formatUtcClock(new Date(asOf))}
          </span>
        </Button>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="font-mono text-xs"
        >
          <Link
            href={`/admin/audit?org=${encodeURIComponent(tenant.organizationId)}`}
          >
            <History />
            Audit trail for {tenant.name}
          </Link>
        </Button>
      </div>
    </AdminPanel>
  );
}
