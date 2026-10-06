import "server-only";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { getDataPageData } from "@/lib/data-page-data";
import type { DataPageData } from "@/lib/types/data";

export const DataActions = {
  async getData(): Promise<DataPageData> {
    const { organizationId, role } = await getRequestContext();

    const prisma = getPrismaClient();
    return getDataPageData(prisma, organizationId, role === "owner");
  },
};
