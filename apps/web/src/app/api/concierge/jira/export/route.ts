import { getServerSession } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { getPrismaClient } from "@sla/db";
import {
  JiraClient,
  JiraPermissionDeniedError,
  JiraReauthRequiredError,
  loadFreshJiraCredentials,
  refreshAfterUnauthorized,
} from "@sla/jira";
import { authOptions } from "@/lib/auth";
import { authorizeSourceExport } from "@/lib/concierge-access";
import { requireIntegrationAvailable } from "@/lib/integration-availability";
import { invalidSinceDaysResponse, parseSinceDays, zipResponse } from "@/lib/concierge-route";
import { JIRA_EXPORT_ZIP_FILE, buildJiraConciergeExport, collectJiraExport } from "@/lib/jira-concierge-export";
import { getJiraOAuthConfig } from "@/lib/jira-env";

export const maxDuration = 300;

/**
 * Exports the Jira half of a Concierge dataset as a ZIP (`jira-issues.csv`,
 * `jira-changelog.csv`, `metadata.json`). The ids in the body only say which
 * of the caller's own rows to use: `authorizeSourceExport` re-checks both
 * against the session before any Jira call.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const sinceDays = parseSinceDays(body.sinceDays);
  if (sinceDays === null) return invalidSinceDaysResponse();

  const prisma = getPrismaClient();
  const access = await authorizeSourceExport(prisma, session, "jira", {
    organizationId: body.organizationId,
    integrationId: body.jiraIntegrationId,
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  // D33: no live Jira call while the provider is unavailable to that organization.
  const unavailable = await requireIntegrationAvailable(access.organizationId, "jira");
  if (unavailable) return unavailable;

  let config;
  try {
    config = await getJiraOAuthConfig(access.organizationId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Jira OAuth is not configured" },
      { status: 500 },
    );
  }

  try {
    const credentials = await loadFreshJiraCredentials(prisma, access.integrationId, config);
    const client = new JiraClient(credentials, {
      onUnauthorized: (failed) => refreshAfterUnauthorized(prisma, access.integrationId, config, failed),
    });
    const collected = await collectJiraExport(client, { sinceDays });
    const files = buildJiraConciergeExport(collected, {
      organizationId: access.organizationId,
      jiraIntegrationId: access.integrationId,
      siteUrl: credentials.siteUrl,
      sinceDays,
    });

    return zipResponse(files.zip, JIRA_EXPORT_ZIP_FILE, {
      records: files.metadata.issueCount,
      history: files.metadata.changelogEntryCount,
    });
  } catch (error) {
    if (error instanceof JiraReauthRequiredError) {
      return NextResponse.json({ error: "Jira needs to be reconnected", reauthRequired: true }, { status: 409 });
    }
    if (error instanceof JiraPermissionDeniedError) {
      return NextResponse.json({ error: "Jira denied access to the requested data" }, { status: 502 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Export failed" }, { status: 502 });
  }
}
