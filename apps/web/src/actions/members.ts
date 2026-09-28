import "server-only";
import { getPrismaClient, listMembers } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import type { OrganizationMemberSummary } from "@/lib/types/members";

export const MembersActions = {
  async getData(): Promise<{ members: OrganizationMemberSummary[]; currentUserId: string }> {
    const { organizationId, userId } = await getRequestContext();

    const prisma = getPrismaClient();
    const members = await listMembers(prisma, organizationId);
    return {
      members: members.map((m) => ({
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      })),
      currentUserId: userId,
    };
  },
};
