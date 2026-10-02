import "server-only";
import { redirect } from "next/navigation";
import { getPrismaClient, getEmailSettingsStatus } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { getDashboardData } from "@/lib/dashboard-data";
import { getFindingsData } from "@/lib/findings-data";
import { getIntegrationsData } from "@/lib/integrations-data";
import { getOnboardingStatus } from "@/lib/onboarding-data";
import { deriveOnboardingProgress } from "@/lib/onboarding-progress";
import { getPolicyImportReview } from "@/lib/policy-import-review-data";
import { recordFirstFindingsViewed } from "@/lib/usage-tracking";
import type {
  ActivationPageData,
  OnboardingPageData,
  PolicyImportReview,
} from "@/lib/types/onboarding";

export const OnboardingActions = {
  async getData(): Promise<OnboardingPageData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    return { status: await getOnboardingStatus(prisma, organizationId) };
  },

  async getPolicyImportReview(): Promise<PolicyImportReview> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    return getPolicyImportReview(prisma, organizationId);
  },

  /** Reached once a ticket source is connected and backfilled (Step 4). A tracker is optional (N5.2); without a ticket source it redirects back to the flow rather than rendering a half-set-up completion screen. */
  async getActivationData(): Promise<ActivationPageData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();

    const status = await getOnboardingStatus(prisma, organizationId);

    if (!deriveOnboardingProgress(status).ticketSourceReady) {
      redirect("/onboarding");
    }

    const [dashboard, integrations, emailSettings, policyReview, findings] =
      await Promise.all([
        getDashboardData(prisma, organizationId),
        getIntegrationsData(prisma, organizationId),
        getEmailSettingsStatus(prisma, organizationId),
        getPolicyImportReview(prisma, organizationId),
        getFindingsData(prisma, organizationId),
      ]);

    // Time to first value (N5.7): the activation screen is where findings first appear.
    void recordFirstFindingsViewed(prisma, organizationId);

    return {
      status,
      atRiskPreview: dashboard.atRisk.slice(0, 3),
      atRiskTotal: dashboard.atRisk.length + dashboard.atRiskOverflowCount,
      slackConnected: integrations.slack.connected,
      emailConfigured: emailSettings.configured,
      importedPolicyCount: policyReview.importedPolicies.length,
      findings,
    };
  },
};
