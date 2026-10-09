import "server-only";
import { getDraft } from "@sla/custom-ticket";
import { getPrismaClient } from "@sla/db";
import { getCustomStatus } from "@/lib/custom-provider/status";
import { getRequestContext } from "@/lib/request-context";
import type { CustomProviderPageData } from "@/lib/types/custom-provider";

export const CustomProviderActions = {
  async getPageData(): Promise<CustomProviderPageData> {
    const { organizationId, role, userId } = await getRequestContext();
    const prisma = getPrismaClient();
    const [flag, status] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { customProviderEnabled: true } }),
      getCustomStatus(prisma, organizationId),
    ]);
    const enabled = flag?.customProviderEnabled === true;
    const isOwner = role === "owner";
    // The draft holds configuration the owner is editing; only the owner of an enabled organization sees it.
    const draft = enabled && isOwner ? await getDraft(prisma, organizationId) : null;
    return { enabled, isOwner, userId, draft, status };
  },
};
