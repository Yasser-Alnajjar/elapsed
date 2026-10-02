import "server-only";
import { notFound } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import { listAdminAuditLog, recordAdminAudit } from "@/lib/admin-audit";
import { requirePlatformAdminPage } from "@/lib/admin-auth";
import { getOperatorMonitoringData } from "@/lib/admin-monitoring-data";
import { getAdminTenantDetail, getAdminTenantsData } from "@/lib/admin-tenants-data";
import type { AdminAuditData, AdminAuditFilters, AdminTenantDetail, AdminTenantsData } from "@/lib/types/admin";
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
    const { actorEmail } = await requirePlatformAdminPage();
    const prisma = getPrismaClient();

    const detail = await getAdminTenantDetail(prisma, organizationId);
    if (!detail) notFound();

    await recordAdminAudit(prisma, { actorEmail, action: "view_tenant", organizationId });
    return detail;
  },

  async getAuditLog(before?: string | null, filters?: AdminAuditFilters): Promise<AdminAuditData> {
    await requirePlatformAdminPage();
    return listAdminAuditLog(getPrismaClient(), { before, filters });
  },
};
