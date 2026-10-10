import { getServerSession } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { getPrismaClient } from "@sla/db";
import {
  ZendeskClient,
  ZendeskPermissionDeniedError,
  ZendeskReauthRequiredError,
  loadFreshZendeskCredentials,
  refreshAfterUnauthorized,
} from "@sla/zendesk";
import { authOptions } from "@/lib/auth";
import { authorizeSourceExport } from "@/lib/concierge-access";
import { requireIntegrationAvailable } from "@/lib/integration-availability";
import { invalidSinceDaysResponse, parseSinceDays, zipResponse } from "@/lib/concierge-route";
import {
  ZENDESK_EXPORT_ZIP_FILE,
  buildZendeskConciergeExport,
  collectZendeskExport,
} from "@/lib/zendesk-concierge-export";
import { getZendeskOAuthConfig } from "@/lib/zendesk-env";

export const maxDuration = 300;

/**
 * Exports the Zendesk half of a Concierge dataset as a ZIP
 * (`zendesk-tickets.csv`, `zendesk-audits.csv`, `metadata.json`). The ids in
 * the body only say which of the caller's own rows to use:
 * `authorizeSourceExport` re-checks both against the session before any
 * Zendesk call.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const sinceDays = parseSinceDays(body.sinceDays);
  if (sinceDays === null) return invalidSinceDaysResponse();

  const prisma = getPrismaClient();
  const access = await authorizeSourceExport(prisma, session, "zendesk", {
    organizationId: body.organizationId,
    integrationId: body.zendeskIntegrationId,
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  // D33: no live Zendesk call while the provider is unavailable to that organization.
  const unavailable = await requireIntegrationAvailable(access.organizationId, "zendesk");
  if (unavailable) return unavailable;

  let config;
  try {
    config = await getZendeskOAuthConfig(access.organizationId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Zendesk OAuth is not configured" },
      { status: 500 },
    );
  }

  try {
    const credentials = await loadFreshZendeskCredentials(prisma, access.integrationId, config);
    const client = new ZendeskClient(credentials, {
      onUnauthorized: (failed) => refreshAfterUnauthorized(prisma, access.integrationId, config, failed),
    });
    const collected = await collectZendeskExport(client, { sinceDays });
    const files = buildZendeskConciergeExport(collected, {
      organizationId: access.organizationId,
      zendeskIntegrationId: access.integrationId,
      subdomain: credentials.subdomain,
      sinceDays,
    });

    return zipResponse(files.zip, ZENDESK_EXPORT_ZIP_FILE, {
      records: files.metadata.ticketCount,
      history: files.metadata.statusChangeCount,
    });
  } catch (error) {
    if (error instanceof ZendeskReauthRequiredError) {
      return NextResponse.json({ error: "Zendesk needs to be reconnected", reauthRequired: true }, { status: 409 });
    }
    if (error instanceof ZendeskPermissionDeniedError) {
      return NextResponse.json({ error: "Zendesk denied access to the requested data" }, { status: 502 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Export failed" }, { status: 502 });
  }
}
