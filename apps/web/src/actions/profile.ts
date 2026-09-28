import "server-only";
import { redirect } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import type { IUser } from "@/lib/types/user";

export const ProfileActions = {
  async getData(): Promise<IUser> {
    const { userId } = await getRequestContext();

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        organizationId: true,
        email: true,
        emailVerifiedAt: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
      },
    });
    if (!user) redirect("/sign-in");

    return user;
  },
};
