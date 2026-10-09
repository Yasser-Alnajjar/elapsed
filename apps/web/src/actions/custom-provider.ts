import "server-only";
import { getDraft } from "@sla/custom-ticket";
import { getPrismaClient, resolveIntegrationAvailability } from "@sla/db";
import { getCustomStatus } from "@/lib/custom-provider/status";
import { getRequestContext } from "@/lib/request-context";
import type { CustomProviderPageData } from "@/lib/types/custom-provider";

export const CustomProviderActions = {
  async getPageData(): Promise<CustomProviderPageData> {
    const { organizationId, role, userId } = await getRequestContext();
    const prisma = getPrismaClient();
    const [availability, status] = await Promise.all([
      resolveIntegrationAvailability(prisma, organizationId, "custom"),
      getCustomStatus(prisma, organizationId),
    ]);
    // D33: available = the provider enabled and this organization on the Custom REST Beta allowlist.
    const enabled = availability.available;
    const isOwner = role === "owner";
    // The draft holds configuration the owner is editing; only the owner of an enabled organization sees it.
    const draft = enabled && isOwner ? await getDraft(prisma, organizationId) : null;
    return { enabled, isOwner, userId, draft, status };
  },
};
