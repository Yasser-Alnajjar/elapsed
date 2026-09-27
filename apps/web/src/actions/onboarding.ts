import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import type { ZendeskCredentials } from "@sla/zendesk";
import { authOptions } from "@/lib/auth";
import { getOnboardingStatus } from "@/lib/onboarding-data";
import { getPolicyImportReview } from "@/lib/policy-import-review-data";
import type { OnboardingPageData, PolicyImportReview } from "@/lib/types/onboarding";

export const OnboardingActions = {
  async getData(): Promise<OnboardingPageData> {
    const session = await getServerSession(authOptions);
    if (!session) redirect("/sign-in");

    const prisma = getPrismaClient();
    const [status, zendeskIntegration] = await Promise.all([
      getOnboardingStatus(prisma, session.user.organizationId),
      prisma.integration.findUnique({
        where: { organizationId_provider: { organizationId: session.user.organizationId, provider: "zendesk" } },
      }),
    ]);
    const zendeskCredentials = (zendeskIntegration?.credentials as ZendeskCredentials | null) ?? null;

    return { status, zendeskSubdomain: zendeskCredentials?.subdomain ?? null };
  },

  async getPolicyImportReview(): Promise<PolicyImportReview> {
    const session = await getServerSession(authOptions);
    if (!session) redirect("/sign-in");

    const prisma = getPrismaClient();
    return getPolicyImportReview(prisma, session.user.organizationId);
  },
};
