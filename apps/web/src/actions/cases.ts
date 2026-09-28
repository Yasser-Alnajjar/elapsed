import "server-only";
import { notFound } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { getCaseDetailData } from "@/lib/case-detail-data";
import { getCaseListData } from "@/lib/case-list-data";
import type { CaseDetailData, CaseListData } from "@/lib/types/cases";

export const CasesActions = {
  async getDetail(caseId: string): Promise<CaseDetailData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    const data = await getCaseDetailData(prisma, organizationId, caseId);
    if (!data) notFound();
    return data;
  },

  async getList(): Promise<CaseListData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    return getCaseListData(prisma, organizationId);
  },
};
