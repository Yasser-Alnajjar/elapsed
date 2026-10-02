import { NextResponse } from "next/server";
import {
  checkEntitlement,
  getPrismaClient,
  integrationResource,
  RESOURCE_LABELS,
  type EntitlementDecision,
  type IntegrationProvider,
  type LimitedResource,
} from "@sla/db";
import { providerRole } from "@/lib/providers";

/**
 * Entitlement gate for the three creation points (N6.3): invite a member,
 * connect an integration, create a native policy. Monitoring is never routed
 * through here. While the operator switch is off (the default) every call is
 * one settings read and returns "proceed".
 */

export const UPGRADE_PATH = "/pricing";

export interface EntitlementWarning {
  resource: LimitedResource;
  message: string;
  upgradeUrl: string;
}

export type CreationGate =
  /** Go ahead. `warning` is set when the plan limit is exceeded: surface it, do not block. */
  | { proceed: true; warning: EntitlementWarning | null }
  /** Stop. Only ever a lapsed trial (D27). */
  | { proceed: false; response: NextResponse };

export const TRIAL_EXPIRED_MESSAGE =
  "Your trial has ended. Existing cases, monitoring and alerts keep running, but adding new configuration needs an upgrade.";

function toGate(decision: EntitlementDecision): CreationGate {
  if (decision.outcome === "allow") return { proceed: true, warning: null };
  if (decision.outcome === "warn") {
    return {
      proceed: true,
      warning: {
        resource: decision.resource,
        message: `You are using ${decision.used} of ${decision.limit} ${RESOURCE_LABELS[decision.resource]} on your plan. Upgrade to add more without limits.`,
        upgradeUrl: UPGRADE_PATH,
      },
    };
  }
  return {
    proceed: false,
    response: NextResponse.json({ error: TRIAL_EXPIRED_MESSAGE, code: "trial_expired", upgradeUrl: UPGRADE_PATH }, { status: 402 }),
  };
}

export async function gateCreation(organizationId: string, resource: LimitedResource): Promise<CreationGate> {
  return toGate(await checkEntitlement(getPrismaClient(), organizationId, resource, { roleOf: providerRole }));
}

/** Connecting a provider the organization already has (a reconnect) takes no new slot. */
export async function gateIntegrationConnect(organizationId: string, provider: IntegrationProvider): Promise<CreationGate> {
  const prisma = getPrismaClient();
  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: { status: true },
  });
  if (existing && existing.status !== "disconnected") return { proceed: true, warning: null };
  return toGate(await checkEntitlement(prisma, organizationId, integrationResource(provider, providerRole), { roleOf: providerRole }));
}

/** Where a blocked connect (a browser navigation, not a fetch) lands. */
export const BLOCKED_CONNECT_REDIRECT = "/settings/integrations?entitlement=trial_expired";
