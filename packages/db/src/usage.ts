import type { IntegrationProvider, PrismaClient } from "../generated/prisma/client";
import type { PlanLimits } from "./plans";

/**
 * What one organization currently uses, in the units the plan limits are
 * written in (N6.2). Measured at read time from live rows; nothing is stored,
 * because the seat model needs no per-period snapshot (D14).
 */
export type OrganizationUsage = Record<keyof PlanLimits, number>;

/** The role a provider plays. Supplied by the caller's adapter registry, so this package never names providers. */
export type ProviderRoleOf = (provider: IntegrationProvider) => "ticket_source" | "work_tracker" | "code_host";

/**
 * - Seats: members plus pending, unexpired invitations (an invitation holds a seat).
 * - Integrations: every row that is not `disconnected`, split by role.
 *   `reauth_required` and `permission_denied` still occupy a slot, since
 *   the customer is expected to repair them, not replace them.
 * - Native policies: native, non-archived. A paused native policy still
 *   counts. Imported policies are excluded by design (D25).
 */
export async function getOrganizationUsage(
  prisma: PrismaClient,
  organizationId: string,
  roleOf: ProviderRoleOf,
  now: Date = new Date(),
): Promise<OrganizationUsage> {
  const [members, pendingInvitations, integrations, nativePolicies] = await Promise.all([
    prisma.user.count({ where: { organizationId } }),
    prisma.organizationInvitation.count({ where: { organizationId, status: "pending", expiresAt: { gt: now } } }),
    prisma.integration.findMany({
      where: { organizationId, status: { not: "disconnected" } },
      select: { provider: true },
    }),
    prisma.sLAPolicy.count({ where: { organizationId, source: "native", archivedAt: null } }),
  ]);

  let ticketSourceIntegrations = 0;
  let engineeringIntegrations = 0;
  for (const { provider } of integrations) {
    if (roleOf(provider) === "ticket_source") ticketSourceIntegrations += 1;
    else engineeringIntegrations += 1;
  }

  return { seats: members + pendingInvitations, ticketSourceIntegrations, engineeringIntegrations, nativePolicies };
}
