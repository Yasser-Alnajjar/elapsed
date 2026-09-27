import "server-only";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { isPlatformOperator } from "@/lib/authz";
import { getOperatorMonitoringData } from "@/lib/operator-monitoring-data";
import type { OperatorMonitoringData } from "@/lib/types/operator";

export const OperatorActions = {
  /**
   * Cross-organization data (roadmap 7.5) — `notFound()` rather than a
   * 403 page for a non-operator: this route doesn't exist for them, the
   * same way a member gets `notFound()` on another organization's case.
   */
  async getData(): Promise<OperatorMonitoringData> {
    const session = await getServerSession(authOptions);
    if (!session) redirect("/sign-in");
    if (!isPlatformOperator(session)) notFound();

    const prisma = getPrismaClient();
    return getOperatorMonitoringData(prisma);
  },
};
