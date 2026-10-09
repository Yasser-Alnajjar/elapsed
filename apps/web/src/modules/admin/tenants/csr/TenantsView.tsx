"use client";

import { SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AuditNotice, PageHeader } from "@/components/admin/admin-ui";
import {
  DataTableCard,
  DataTableEmpty,
  DataTableFooter,
  DataTableRangeSummary,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { formatTimestampWithZone } from "@/lib/format";
import {
  countByHealth,
  DEFAULT_TENANT_CONTROLS,
  selectTenants,
  type TenantListControls,
} from "@/lib/admin-tenant-list";
import type { AdminTenantsData } from "@/lib/types/admin";
import { TenantCards } from "./TenantCards";
import { TenantsSummary } from "./TenantsSummary";
import { TenantsTable } from "./TenantsTable";
import { TenantsToolbar } from "./TenantsToolbar";

interface TenantsViewProps {
  data: AdminTenantsData;
  /** From the top-bar search (`?q=`); seeds the search box. */
  initialQuery: string;
}

/**
 * Every customer on one page (N4.4): who they are, which plan and status each
 * is on, whether each is healthy, and how much work each is doing. Read-only;
 * the plan record is edited on the tenant's own page, where every edit is
 * audited. Filtering and sorting happen here, over the list the server sent.
 */
export function TenantsView({ data, initialQuery }: TenantsViewProps) {
  const timeZone = useOrgTimezone();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [controls, setControls] = useState<TenantListControls>({
    ...DEFAULT_TENANT_CONTROLS,
    query: initialQuery,
  });

  const visible = useMemo(
    () => selectTenants(data.tenants, controls),
    [data.tenants, controls],
  );
  const counts = useMemo(() => countByHealth(data.tenants), [data.tenants]);
  const filtered =
    controls.query !== "" ||
    controls.health !== "all" ||
    controls.plan !== "all";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Tenants"
        suffix={`(${data.tenants.length} organization${data.tenants.length === 1 ? "" : "s"})`}
        description="Who the customers are, which plan and status each is on, and whether each is healthy right now."
        aside={
          <AuditNotice label="Strict audit protocol">
            Opening a tenant records a{" "}
            <code className="text-primary font-mono font-bold">
              view_tenant
            </code>{" "}
            entry in the audit log.
          </AuditNotice>
        }
      />

      <TenantsSummary data={data} />

      {/* `@container` lets the list pick table or cards by the room it actually has (the sidebar eats some). */}
      <DataTableCard className="@container">
        <TenantsToolbar
          controls={controls}
          counts={counts}
          refreshing={refreshing}
          onChange={(next) => setControls((current) => ({ ...current, ...next }))}
          onRefresh={() => startRefresh(() => router.refresh())}
          onReset={filtered ? () => setControls(DEFAULT_TENANT_CONTROLS) : undefined}
        />

        {visible.length === 0 ? (
          <DataTableEmpty
            icon={SearchX}
            title={
              data.tenants.length === 0
                ? "No organizations yet"
                : "No tenants match"
            }
            description={
              data.tenants.length === 0
                ? "Organizations appear here as customers sign up."
                : "Nothing fits the current search and filters."
            }
            action={
              filtered && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setControls(DEFAULT_TENANT_CONTROLS)}
                >
                  Reset filters
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="hidden @min-[1130px]:block">
              <TenantsTable tenants={visible} />
            </div>
            <div className="@min-[1130px]:hidden">
              <TenantCards tenants={visible} />
            </div>
          </>
        )}

        <DataTableFooter>
          <DataTableRangeSummary
            shown={visible.length}
            total={data.tenants.length}
            label="tenants"
          />
          <span>Snapshot as of {formatTimestampWithZone(data.asOf, timeZone)}</span>
        </DataTableFooter>
      </DataTableCard>
    </div>
  );
}
