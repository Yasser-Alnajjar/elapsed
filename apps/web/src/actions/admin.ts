import "server-only";
import { notFound } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import { listAdminAuditLog, recordAdminAudit } from "@/lib/admin-audit";
import { requirePlatformAdminPage } from "@/lib/admin-auth";
import { getAdminBillingOverviewData, getAdminTenantBillingDetail } from "@/lib/admin-billing-data";
import { getBillingProvider } from "@/lib/billing-provider";
import { getOperatorMonitoringData } from "@/lib/admin-monitoring-data";
import { getAdminUsageData } from "@/lib/admin-usage-data";
import { getAdminTenantDetail, getAdminTenantsData } from "@/lib/admin-tenants-data";
import type { AdminAuditData, AdminAuditFilters, AdminTenantDetail, AdminTenantsData, AdminUsageData } from "@/lib/types/admin";
import type { AdminBillingOverviewData, AdminTenantBillingDetail } from "@/lib/types/admin-billing";
import type { OperatorMonitoringData } from "@/lib/types/operator";

/**
 * Server-side reads for the platform-admin area (`/admin`). Every function
 * confirms the caller is a platform operator first (`notFound()` otherwise,
 * before anything is queried), and none of them is reachable from tenant
 * code: this module is deliberately NOT part of the `Actions` barrel in
 * `./index.ts`, which tenant pages import. `admin-boundary.test.ts` fails if
 * anything outside the admin area imports it.
 */
export const AdminActions = {
  /** Failed integrations and alert deliveries across every organization (roadmap 7.5, N3.9). */
  async getOverview(): Promise<OperatorMonitoringData> {
    await requirePlatformAdminPage();
    return getOperatorMonitoringData(getPrismaClient());
  },

  /** Weekly active organizations, alert click-through and time to first value (N5.7). */
  async getUsage(): Promise<AdminUsageData> {
    await requirePlatformAdminPage();
    return getAdminUsageData(getPrismaClient());
  },

  async getTenants(): Promise<AdminTenantsData> {
    await requirePlatformAdminPage();
    return getAdminTenantsData(getPrismaClient());
  },

  /**
   * One tenant in depth. Viewing it is itself audited (`view_tenant`): the
   * row is written before the data is returned, so a tenant's detail is never
   * shown without a record that this operator looked.
   */
  async getTenantDetail(organizationId: string): Promise<AdminTenantDetail> {
    const { user } = await requirePlatformAdminPage();
    const prisma = getPrismaClient();

    const detail = await getAdminTenantDetail(prisma, organizationId);
    if (!detail) notFound();

    await recordAdminAudit(prisma, { actorEmail: user.email, action: "view_tenant", organizationId });
    return detail;
  },

  async getAuditLog(before?: string | null, filters?: AdminAuditFilters): Promise<AdminAuditData> {
    await requirePlatformAdminPage();
    return listAdminAuditLog(getPrismaClient(), { before, filters });
  },

  /** Revenue, subscription state, seats and payment risk across every organization (N6.5). */
  async getBillingOverview(): Promise<AdminBillingOverviewData> {
    await requirePlatformAdminPage();
    return getAdminBillingOverviewData(getPrismaClient(), { providerAvailable: getBillingProvider() !== null });
  },

  /**
   * One organization's billing lifecycle. Audited like `getTenantDetail`:
   * the `view_tenant` row is written before the data is returned.
   */
  async getTenantBilling(organizationId: string): Promise<AdminTenantBillingDetail> {
    const { user } = await requirePlatformAdminPage();
    const prisma = getPrismaClient();

    const detail = await getAdminTenantBillingDetail(prisma, organizationId, { providerAvailable: getBillingProvider() !== null });
    if (!detail) notFound();

    await recordAdminAudit(prisma, { actorEmail: user.email, action: "view_tenant", organizationId, metadata: { section: "billing" } });
    return detail;
  },
};
