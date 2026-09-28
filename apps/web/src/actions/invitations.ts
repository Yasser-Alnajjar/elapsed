import "server-only";
import { getPrismaClient, listPendingInvitations } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import type { PendingInvitation } from "@/lib/types/invitations";

export const InvitationsActions = {
  async getData(): Promise<PendingInvitation[]> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    const invitations = await listPendingInvitations(prisma, organizationId);
    return invitations.map((i) => ({
      id: i.id,
      email: i.email,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  },
};
