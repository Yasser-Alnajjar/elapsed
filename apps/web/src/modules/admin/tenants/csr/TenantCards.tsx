import Link from "next/link";
import { Tag } from "@/components/admin/admin-ui";
import {
  HealthBadge,
  IntegrationChip,
  PlanChip,
  PlanStatusBadge,
  tenantHealthReasons,
} from "@/components/admin/tenant-badges";
import { formatUtcShort, shortId } from "@/lib/admin-format";
import type { AdminTenantRow, TenantHealth } from "@/lib/types/admin";
import { cn } from "@/lib/utils";
import { LinkCoverageMeter } from "./LinkCoverageMeter";

const HEALTH_EDGE: Record<TenantHealth, string> = {
  unhealthy: "border-l-error",
  attention: "border-l-warning",
  healthy: "border-l-border",
  none: "border-l-border",
};

/**
 * The list when there is not room for the table (a phone, a tablet, a narrow
 * window): one card per tenant, led by its health word, in as many columns as
 * the width allows.
 */
export function TenantCards({ tenants }: { tenants: AdminTenantRow[] }) {
  return (
    <ul className="grid gap-3 p-3 @min-[640px]:grid-cols-2 @min-[960px]:grid-cols-3">
      {tenants.map((tenant) => (
        <li
          key={tenant.organizationId}
          className={cn(
            "bg-surface-raised/40 border-border overflow-hidden rounded-lg border border-l-2",
            HEALTH_EDGE[tenant.health],
          )}
        >
          <Link
            href={`/admin/tenants/${tenant.organizationId}`}
            className="hover:bg-surface-raised/70 flex h-full flex-col gap-3 p-4 transition-colors"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <HealthBadge health={tenant.health} />
              <Tag title={tenant.organizationId} className="text-primary">
                {shortId(tenant.organizationId)}
              </Tag>
            </div>

            <div>
              <p className="text-foreground text-base font-semibold">
                {tenant.name}
              </p>
              <p className="text-muted-foreground truncate font-mono text-xs">
                {tenant.ownerEmail ?? "No owner"}
              </p>
              <p className="text-foreground-subtle mt-1 font-mono text-xxs">
                {tenantHealthReasons(tenant).join(" · ")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <PlanChip plan={tenant.plan} />
              <PlanStatusBadge status={tenant.planStatus} />
            </div>

            {tenant.integrations.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {tenant.integrations.map((integration) => (
                  <li key={integration.id}>
                    <IntegrationChip row={integration}>
                      <span className="text-foreground-subtle font-mono text-[10px]">
                        {formatUtcShort(integration.lastSuccessfulSyncAt)}
                      </span>
                    </IntegrationChip>
                  </li>
                ))}
              </ul>
            )}

            <dl className="mt-auto grid grid-cols-3 gap-3 font-mono">
              <div>
                <dt className="text-foreground-subtle text-[10px] uppercase">
                  Open cases
                </dt>
                <dd className="text-foreground text-sm font-bold tabular-nums">
                  {tenant.openCases}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-subtle text-[10px] uppercase">
                  Alerts failing
                </dt>
                <dd
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    tenant.notificationsFailed24h > 0
                      ? "text-error"
                      : "text-foreground",
                  )}
                >
                  {tenant.notificationsFailed24h}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-subtle text-[10px] uppercase">
                  Members
                </dt>
                <dd className="text-foreground text-sm font-bold tabular-nums">
                  {tenant.memberCount}
                  {tenant.pendingInvitations > 0 && (
                    <span className="text-foreground-subtle text-[10px] font-normal">
                      {" "}
                      +{tenant.pendingInvitations}
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            <LinkCoverageMeter coverage={tenant.linkCoverage} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
