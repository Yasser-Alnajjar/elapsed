import "server-only";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { getNotificationSettingsData } from "@/lib/notification-settings-data";
import type { NotificationSettingsData } from "@/lib/types/notification-settings";

export const NotificationsActions = {
  async getData(): Promise<NotificationSettingsData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    return getNotificationSettingsData(prisma, organizationId);
  },
};
