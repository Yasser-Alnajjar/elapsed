import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import {
  getIntegrationConfigStatus,
  saveIntegrationConfig,
  deleteIntegrationConfig,
  type ConfigurableIntegrationProvider,
  getPrismaClient,
} from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { requireIntegrationAvailable } from "@/lib/integration-availability";

/**
 * Shared GET/POST/DELETE handlers for `/api/integrations/{provider}/config`,
 * reused by the zendesk/jira/slack route files — the three configurable
 * integrations all save the same shape (client id + secret), so this is the
 * one place that logic lives rather than being copy-pasted three times.
 */
export function createIntegrationConfigHandlers(
  provider: ConfigurableIntegrationProvider,
) {
  /**
   * D33: configuration writes for an unavailable provider are refused (reads
   * stay open). Slack is a notification channel, outside N10 (ruling 7).
   */
  async function availabilityGate(organizationId: string) {
    return provider === "slack" ? null : requireIntegrationAvailable(organizationId, provider);
  }

  async function GET() {
    const session = await getServerSession(authOptions);
    if (!session)
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const status = await getIntegrationConfigStatus(
      getPrismaClient(),
      session.user.organizationId,
      provider,
    );

    return NextResponse.json(status);
  }

  async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session)
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const denied = requireOwner(session);
    if (denied) return denied;
    const unavailable = await availabilityGate(session.user.organizationId);
    if (unavailable) return unavailable;

    const body = (await request.json().catch(() => null)) as {
      clientId?: unknown;
      clientSecret?: unknown;
    } | null;

    const clientId =
      typeof body?.clientId === "string" ? body.clientId.trim() : "";
    const clientSecret =
      typeof body?.clientSecret === "string" ? body.clientSecret.trim() : "";

    if (!clientId) {
      return NextResponse.json(
        { error: "Client ID is required" },
        { status: 400 },
      );
    }

    // Sessions are JWTs, never checked against the database, so one can
    // outlive its organization (e.g. a dev database reset). Without this the
    // create below fails on the foreign key with a raw Prisma error.
    const organization = await getPrismaClient().organization.findUnique({
      where: { id: session.user.organizationId },
      select: { id: true },
    });
    if (!organization) {
      return NextResponse.json(
        {
          error:
            "Your session refers to an organization that no longer exists. Sign out and sign in again.",
        },
        { status: 401 },
      );
    }

    try {
      await saveIntegrationConfig(
        getPrismaClient(),
        session.user.organizationId,
        provider,
        {
          clientId,
          // Empty string means "leave the existing secret unchanged" on an update.
          clientSecret: clientSecret || undefined,
        },
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to save configuration",
        },
        { status: 400 },
      );
    }

    const status = await getIntegrationConfigStatus(
      getPrismaClient(),
      session.user.organizationId,
      provider,
    );

    return NextResponse.json(status);
  }

  /**
   * Permanently deletes the configuration (see `deleteIntegrationConfig`):
   * unlike `/disconnect`, the integration returns to its unconfigured state
   * and must be configured from scratch before it can be connected again.
   * Refused with 409 while the integration is connected — disconnect first.
   */
  async function DELETE() {
    const session = await getServerSession(authOptions);
    if (!session)
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const denied = requireOwner(session);
    if (denied) return denied;
    const unavailable = await availabilityGate(session.user.organizationId);
    if (unavailable) return unavailable;

    const result = await deleteIntegrationConfig(
      getPrismaClient(),
      session.user.organizationId,
      provider,
    );

    if (result === "not_configured") {
      return NextResponse.json(
        { error: "This integration is not configured" },
        { status: 404 },
      );
    }
    if (result === "connected") {
      return NextResponse.json(
        {
          error:
            "Disconnect this integration before deleting its configuration",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ configured: false, clientId: null });
  }

  return { GET, POST, DELETE };
}
