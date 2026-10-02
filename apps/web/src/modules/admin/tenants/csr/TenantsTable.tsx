import { ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { MonoLabel, Tag } from "@/components/admin/admin-ui";
import {
  HealthBadge,
  IntegrationChip,
  PlanChip,
  PlanStatusBadge,
  tenantHealthReasons,
} from "@/components/admin/tenant-badges";
import {
  formatUtcDate,
  formatUtcShort,
  formatUtcTimestamp,
  shortId,
} from "@/lib/admin-format";
import type { AdminTenantRow, TenantHealth } from "@/lib/types/admin";
import { cn } from "@/lib/utils";
import { LinkCoverageMeter } from "./LinkCoverageMeter";

const HEALTH_EDGE: Record<TenantHealth, string> = {
  unhealthy: "border-l-error",
  attention: "border-l-warning",
  healthy: "border-l-transparent",
  none: "border-l-transparent",
};

const COLUMNS = [
  "Tenant & owner",
  "Plan & status",
  "Health",
  "Integrations",
  "Cases",
  "Link coverage (30 d)",
  "Last 24 h",
  "",
];

/**
 * The dense list. It never scrolls sideways: `TenantsView` only renders it when
 * its container is wide enough (see `TABLE_MIN_WIDTH`), and shows cards
 * otherwise. It also has no scroll box of its own, so the page scrolls once and
 * the header sticks under the top bar.
 */
export function TenantsTable({ tenants }: { tenants: AdminTenantRow[] }) {
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th
              key={column || "open"}
              scope="col"
              className={cn(
                "bg-surface-raised border-border sticky top-14 z-10 border-b px-3 py-2.5 whitespace-nowrap first:pl-4 last:pr-4",
                column === "Cases" && "text-center",
              )}
            >
              {column ? (
                <MonoLabel>{column}</MonoLabel>
              ) : (
                <span className="sr-only">Actions</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-border divide-y">
        {tenants.map((tenant) => (
          <TenantRow key={tenant.organizationId} tenant={tenant} />
        ))}
      </tbody>
    </table>
  );
}

function TenantRow({ tenant }: { tenant: AdminTenantRow }) {
  const href = `/admin/tenants/${tenant.organizationId}`;
  const reasons = tenantHealthReasons(tenant);
  const bad = tenant.health === "unhealthy" || tenant.health === "attention";

  return (
    <tr className="group hover:bg-surface-raised/60 transition-colors">
      <td
        className={cn(
          "border-l-2 py-3 pr-3 pl-4 align-top",
          HEALTH_EDGE[tenant.health],
        )}
      >
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href}
              className="text-foreground group-hover:text-primary text-sm font-semibold transition-colors"
            >
              {tenant.name}
            </Link>
            <Tag title={tenant.organizationId} className="text-primary">
              {shortId(tenant.organizationId)}
            </Tag>
          </div>
          <span className="text-muted-foreground flex max-w-44 items-center gap-1.5 font-mono text-xs">
            <Mail
              className="text-foreground-subtle size-3 shrink-0"
              aria-hidden
            />
            <span className="truncate" title={tenant.ownerEmail ?? undefined}>
              {tenant.ownerEmail ?? "No owner"}
            </span>
          </span>
          <span
            className="text-foreground-subtle font-mono text-[10px]"
            title={formatUtcTimestamp(tenant.createdAt)}
          >
            Created {formatUtcDate(tenant.createdAt)} · {tenant.memberCount}{" "}
            member{tenant.memberCount === 1 ? "" : "s"}
            {tenant.pendingInvitations > 0 &&
              ` (+${tenant.pendingInvitations} invited)`}
          </span>
        </div>
      </td>

      <td className="px-3 py-3 align-top">
        <div className="flex flex-col items-start gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <PlanChip plan={tenant.plan} />
            <PlanStatusBadge status={tenant.planStatus} />
          </div>
          <span className="text-foreground-subtle font-mono text-[10px]">
            {tenant.planStatus === "trial" && tenant.trialEndsAt
              ? `Trial ends ${formatUtcDate(tenant.trialEndsAt)}`
              : tenant.billingReference
                ? `Ref ${tenant.billingReference}`
                : "No billing reference"}
            <span className="italic"> · informational</span>
          </span>
        </div>
      </td>

      <td className="px-3 py-3 align-top">
        <div className="flex flex-col items-start gap-1.5">
          <HealthBadge health={tenant.health} />
          <ul
            className={cn(
              "flex flex-col font-mono text-xxs leading-4",
              tenant.health === "unhealthy"
                ? "text-error"
                : bad
                  ? "text-warning-text"
                  : "text-muted-foreground",
            )}
          >
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      </td>

      <td className="px-3 py-3 align-top">
        {tenant.integrations.length === 0 ? (
          <span className="text-foreground-subtle font-mono text-xs">
            None connected
          </span>
        ) : (
          <ul className="flex min-w-52 flex-col gap-1.5">
            {tenant.integrations.map((integration) => (
              <li key={integration.id}>
                <IntegrationChip row={integration}>
                  <span
                    className="text-foreground-subtle font-mono text-[10px] whitespace-nowrap"
                    title={`Last successful sync: ${formatUtcTimestamp(integration.lastSuccessfulSyncAt)}`}
                  >
                    {formatUtcShort(integration.lastSuccessfulSyncAt)}
                  </span>
                </IntegrationChip>
              </li>
            ))}
          </ul>
        )}
      </td>

      <td className="px-3 py-3 text-center align-top">
        <span className="text-foreground font-mono text-base font-bold tabular-nums">
          {tenant.openCases}
        </span>
        <span className="text-foreground-subtle block font-mono text-[10px]">
          open
        </span>
      </td>

      <td className="px-3 py-3 align-top">
        <LinkCoverageMeter coverage={tenant.linkCoverage} />
      </td>

      <td className="px-3 py-3 align-top">
        <ul className="flex flex-col font-mono text-xxs leading-4 tabular-nums">
          <li className="text-muted-foreground">
            {tenant.evaluations24h} evaluations
          </li>
          <li className="text-muted-foreground">
            {tenant.notificationsSent24h} alerts sent
          </li>
          <li
            className={cn(
              tenant.notificationsFailed24h > 0
                ? "text-error font-semibold"
                : "text-muted-foreground",
            )}
          >
            {tenant.notificationsFailed24h} alerts failing
          </li>
        </ul>
      </td>

      <td className="py-3 pr-4 pl-3 text-right align-top">
        <Link
          href={href}
          aria-label={`Open ${tenant.name}`}
          title={`Open ${tenant.name}`}
          className="border-border text-muted-foreground hover:border-primary hover:text-primary inline-flex size-8 items-center justify-center rounded border transition-colors"
        >
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </td>
    </tr>
  );
}
