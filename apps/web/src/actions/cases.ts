import "server-only";
import { notFound } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { getCaseDetailData } from "@/lib/case-detail-data";
import { getCaseListData } from "@/lib/case-list-data";
import { recordAlertOpened } from "@/lib/usage-tracking";
import type {
  CaseDetailData,
  CaseListData,
  CaseListParams,
} from "@/lib/types/cases";

export const CasesActions = {
  async getDetail(caseId: string, options: { alertNotificationId?: string } = {}): Promise<CaseDetailData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    const data = await getCaseDetailData(prisma, organizationId, caseId);
    if (!data) notFound();
    // Alert click-through (N5.7). Only after the case proved to be this
    // organization's, and scoped to it again in the write.
    if (options.alertNotificationId) {
      void recordAlertOpened(prisma, { organizationId, caseId, notificationId: options.alertNotificationId });
    }
    return data;
  },

  async getList(params: Partial<CaseListParams> = {}): Promise<CaseListData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    return getCaseListData(prisma, organizationId, params);
  },
};
