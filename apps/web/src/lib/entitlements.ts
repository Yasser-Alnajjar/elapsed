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
import { getUpgradeCta } from "@/lib/upgrade-cta";

/**
 * Entitlement gate for the three creation points (N6.3): invite a member,
 * connect an integration, create a native policy. Monitoring is never routed
 * through here. While the operator switch is off (the default) every call is
 * one settings read and returns "proceed".
 */

export interface EntitlementWarning {
  resource: LimitedResource;
  /** `reached`: this creation took the organization to its limit. `exceeded`: past it. */
  level: "reached" | "exceeded";
  message: string;
  /** Where to ask for an upgrade (`getUpgradeCta`), or null when no contact is configured. */
  upgradeUrl: string | null;
}

export type CreationGate =
  /** Go ahead. `warning` is set when the plan limit is exceeded: surface it, do not block. */
  | { proceed: true; warning: EntitlementWarning | null }
  /** Stop. Only ever a lapsed trial (D27). */
  | { proceed: false; response: NextResponse };

export const TRIAL_EXPIRED_MESSAGE =
  "Your trial has ended. Cases, SLA monitoring, alerts and history keep working, but adding members, integrations or SLA policies needs an upgrade.";

function toGate(decision: EntitlementDecision): CreationGate {
  if (decision.outcome === "allow") return { proceed: true, warning: null };
  if (decision.outcome === "warn") {
    const exceeded = decision.used > decision.limit;
    const label = RESOURCE_LABELS[decision.resource];
    return {
      proceed: true,
      warning: {
        resource: decision.resource,
        level: exceeded ? "exceeded" : "reached",
        message: exceeded
          ? `You are over your plan's limit: ${decision.used} of ${decision.limit} ${label}. Nothing is switched off.`
          : `You have reached your plan's limit: ${decision.used} of ${decision.limit} ${label}. Adding more will put you over it. Nothing is switched off.`,
        upgradeUrl: getUpgradeCta().href,
      },
    };
  }
  return {
    proceed: false,
    response: NextResponse.json({ error: TRIAL_EXPIRED_MESSAGE, code: "trial_expired", upgradeUrl: getUpgradeCta().href }, { status: 402 }),
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

/** Where a blocked connect (a browser navigation, not a fetch) lands, with what was blocked so the page can say so. */
export function blockedConnectRedirect(provider: IntegrationProvider): string {
  return `/settings/integrations?entitlement=trial_expired&action=connect&provider=${provider}`;
}
