import "server-only";
import { redirect } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import type { OrganizationSettingsData } from "@/lib/types/organization";

export const OrganizationActions = {
  async getData(): Promise<OrganizationSettingsData> {
    const { organizationId, role } = await getRequestContext();

    const organization = await getPrismaClient().organization.findUnique({
      where: { id: organizationId },
      select: { name: true, timezone: true },
    });
    if (!organization) redirect("/sign-in");

    return { ...organization, canEdit: role === "owner" };
  },
};
