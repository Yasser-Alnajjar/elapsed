import { NextResponse } from "next/server";
import { reconnectCustom } from "@/lib/custom-provider/activation";
import { failure, ownerGuard, readJson } from "@/lib/custom-provider/route-guard";
import { gateIntegrationConnect } from "@/lib/entitlements";

/**
 * Reconnects a disconnected Custom REST source on the configuration version
 * that was active when it was disconnected (owner only, audited, platform
 * availability and the plan's connect entitlement apply like any connect).
 * `{ secrets }`: the credentials the active configuration's authentication
 * needs, entered again because Disconnect cleared them. No draft is read and no
 * configuration version is created.
 */
export async function POST(request: Request) {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const { prisma, organizationId, userId } = guard.ctx;
  const gate = await gateIntegrationConnect(organizationId, "custom");
  if (!gate.proceed) return gate.response;
  const body = await readJson(request);
  const secrets = body?.secrets;
  if (secrets === null || typeof secrets !== "object" || Array.isArray(secrets)) return failure("invalid_secrets", 422);
  const result = await reconnectCustom(prisma, { organizationId, userId, secrets: secrets as Record<string, unknown> });
  switch (result.status) {
    case "reconnected":
      return NextResponse.json({ status: "reconnected", version: result.version, warning: gate.warning });
    case "invalid_secrets":
      return failure("invalid_secrets", 422, { missing: result.missing });
    case "not_disconnected":
      return failure("not_disconnected", 409);
    case "no_active_configuration":
      return failure("no_active_configuration", 409);
    case "conflict":
      return failure("conflict", 409);
  }
}
