import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getPrismaClient, getEmailSettingsStatus } from "@sla/db";
import type { ZendeskCredentials } from "@sla/zendesk";
import { authOptions } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";
import { getFindingsData } from "@/lib/findings-data";
import { getIntegrationsData } from "@/lib/integrations-data";
import { getOnboardingStatus } from "@/lib/onboarding-data";
import { getPolicyImportReview } from "@/lib/policy-import-review-data";
import type {
  ActivationPageData,
  OnboardingPageData,
  PolicyImportReview,
} from "@/lib/types/onboarding";

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

  /** Reached only once onboarding is actually done (Step 4) — redirects back to the flow otherwise rather than rendering a half-set-up completion screen. */
  async getActivationData(): Promise<ActivationPageData> {
    const session = await getServerSession(authOptions);
    if (!session) redirect("/sign-in");

    const prisma = getPrismaClient();
    const organizationId = session.user.organizationId;

    const status = await getOnboardingStatus(prisma, organizationId);

    const onboardingComplete =
      status.zendesk.connected &&
      status.zendesk.backfillComplete &&
      status.jira.connected;

    if (!onboardingComplete) {
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
