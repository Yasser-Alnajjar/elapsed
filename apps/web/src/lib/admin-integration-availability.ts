import {
  CATALOG_PROVIDERS,
  catalogEntry,
  decideAvailability,
  defaultAvailabilityPolicy,
  getIntegrationAvailabilityPolicy,
  getWorkerSettingsForRead,
  listIntegrationAvailabilityPolicies,
  type IntegrationAvailabilityPolicy,
  type IntegrationProvider,
  type Prisma,
  type PrismaClient,
} from "@sla/db";
import { recordAdminAudit } from "./admin-audit";
import { AdminConflictError, AdminNotFoundError, AdminValidationError } from "./admin-tenant-mutations";
import { staleFields } from "./freshness-data";
import {
  AVAILABILITY_REASON_MAX_LENGTH,
  BETA_ACCESS_MODES,
  RELEASE_STAGES,
  STATUS_MESSAGE_MAX_LENGTH,
  type AdminIntegrationAvailabilityRow,
  type AdminIntegrationsData,
  type AvailabilityImpact,
  type AvailabilityPolicyFields,
  type BetaAccessMode,
  type ReleaseStage,
} from "./types/admin";

/**
 * The Integration Control Center's reads and writes (N10, D33, plan 10 §7).
 * Platform-level availability only: nothing here reads or writes an
 * integration's credentials, configuration or data, and nothing changes
 * `Integration.status` (a platform restriction is not a customer disconnect).
 * Every write is one transaction with exactly one `AdminAuditLog` row; a write
 * that would change nothing writes neither.
 */

/** A refused change, with the documented code the API returns (409). */
export class AvailabilityConflictError extends AdminConflictError {
  constructor(
    readonly code: "stale_version" | "rollout_blocked" | "already_listed" | "not_listed",
    message: string,
  ) {
    super(message);
  }
}

export function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return typeof value === "string" && (CATALOG_PROVIDERS as string[]).includes(value);
}

const policyFields = (policy: IntegrationAvailabilityPolicy): AvailabilityPolicyFields => ({
  enabled: policy.enabled,
  releaseStage: policy.releaseStage,
  betaAccess: policy.betaAccess,
  statusMessage: policy.statusMessage,
});

// ---- Input -------------------------------------------------------------------

export interface AvailabilityChangeInput {
  expectedVersion: number;
  changes: Partial<AvailabilityPolicyFields>;
  reason: string;
}

export function parseReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) throw new AdminValidationError("A reason is required; it is recorded in the audit log");
  if (reason.length > AVAILABILITY_REASON_MAX_LENGTH) {
    throw new AdminValidationError(`The reason must be at most ${AVAILABILITY_REASON_MAX_LENGTH} characters`);
  }
  return reason;
}

/** The policy fields of a request body, validated; only the fields present. */
export function parsePolicyChanges(input: Record<string, unknown>): Partial<AvailabilityPolicyFields> {
  const changes: Partial<AvailabilityPolicyFields> = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new AdminValidationError("enabled must be true or false");
    changes.enabled = input.enabled;
  }
  if (input.releaseStage !== undefined) {
    if (!(RELEASE_STAGES as readonly unknown[]).includes(input.releaseStage)) {
      throw new AdminValidationError(`releaseStage must be one of: ${RELEASE_STAGES.join(", ")}`);
    }
    changes.releaseStage = input.releaseStage as ReleaseStage;
  }
  if (input.betaAccess !== undefined) {
    if (!(BETA_ACCESS_MODES as readonly unknown[]).includes(input.betaAccess)) {
      throw new AdminValidationError(`betaAccess must be one of: ${BETA_ACCESS_MODES.join(", ")}`);
    }
    changes.betaAccess = input.betaAccess as BetaAccessMode;
  }
  if (input.statusMessage !== undefined) {
    if (input.statusMessage !== null && typeof input.statusMessage !== "string") {
      throw new AdminValidationError("statusMessage must be text or null");
    }
    const trimmed = typeof input.statusMessage === "string" ? input.statusMessage.trim() : "";
    if (trimmed.length > STATUS_MESSAGE_MAX_LENGTH) {
      throw new AdminValidationError(`statusMessage must be at most ${STATUS_MESSAGE_MAX_LENGTH} characters`);
    }
    changes.statusMessage = trimmed === "" ? null : trimmed;
  }
  return changes;
}

/** Validates a PATCH body into a change; throws `AdminValidationError` with a message fit to show. */
export function parseAvailabilityChange(body: unknown): AvailabilityChangeInput {
  if (typeof body !== "object" || body === null) throw new AdminValidationError("A change is required");
  const input = body as Record<string, unknown>;
  if (typeof input.expectedVersion !== "number" || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new AdminValidationError("expectedVersion is required (the version you are editing)");
  }
  const changes = parsePolicyChanges(input);
  if (Object.keys(changes).length === 0) throw new AdminValidationError("Nothing to change");
  return { expectedVersion: input.expectedVersion, changes, reason: parseReason(input.reason) };
}

// ---- Rollout block (D33 ruling 3) -----------------------------------------------

/**
 * While the catalog carries a rollout block (Custom REST: N9.14-F1), refuse
 * any change that would widen availability beyond an allowlist. Narrowing
 * (disable, Coming Soon, removing organizations) stays allowed.
 */
function assertRolloutAllowed(provider: IntegrationProvider, before: AvailabilityPolicyFields, after: AvailabilityPolicyFields) {
  const block = catalogEntry(provider).rolloutBlock;
  if (!block) return;
  const widensStage = after.releaseStage === "stable" && before.releaseStage !== "stable";
  const widensAccess = after.betaAccess === "all_organizations" && before.betaAccess !== "all_organizations";
  if (widensStage || widensAccess) {
    throw new AvailabilityConflictError("rollout_blocked", `Blocked by ${block.id}: ${block.reason}`);
  }
}

// ---- Reads -------------------------------------------------------------------

export async function getAdminIntegrationsData(prisma: PrismaClient, now: Date = new Date()): Promise<AdminIntegrationsData> {
  const [policies, allowlist, integrations, settings, organizations] = await Promise.all([
    listIntegrationAvailabilityPolicies(prisma),
    prisma.integrationBetaAllowlist.findMany({
      orderBy: { createdAt: "asc" },
      select: { provider: true, organizationId: true, addedByEmail: true, createdAt: true, organization: { select: { name: true } } },
    }),
    // Health fields only: credentials are never selected.
    prisma.integration.findMany({
      where: { status: { not: "disconnected" } },
      select: {
        provider: true,
        organizationId: true,
        status: true,
        consecutiveFailures: true,
        lastSuccessfulSyncAt: true,
      },
    }),
    getWorkerSettingsForRead(prisma),
    prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const asOf = now.toISOString();
  const rows: AdminIntegrationAvailabilityRow[] = policies.map((policy) => {
    const entry = catalogEntry(policy.provider);
    const listed = allowlist.filter((row) => row.provider === policy.provider);
    const listedIds = new Set(listed.map((row) => row.organizationId));
    const connections = integrations.filter((row) => row.provider === policy.provider);
    const health = { healthy: 0, failing: 0, needsAttention: 0, stale: 0 };
    let pausedConnections = 0;
    for (const row of connections) {
      if (!decideAvailability(policy, listedIds.has(row.organizationId)).available) pausedConnections += 1;
      if (row.status === "reauth_required" || row.status === "permission_denied") health.needsAttention += 1;
      else if (row.consecutiveFailures > 0) health.failing += 1;
      else if (staleFields(row, asOf, settings).stale) health.stale += 1;
      else health.healthy += 1;
    }
    return {
      provider: policy.provider,
      name: entry.name,
      category: entry.category,
      connectionType: entry.connectionType,
      ...policyFields(policy),
      version: policy.version,
      updatedAt: policy.updatedAt?.toISOString() ?? null,
      updatedByEmail: policy.updatedByEmail,
      allowlist: listed.map((row) => ({
        organizationId: row.organizationId,
        organizationName: row.organization.name,
        addedByEmail: row.addedByEmail,
        createdAt: row.createdAt.toISOString(),
      })),
      connections: connections.length,
      activeOrganizations: new Set(connections.map((row) => row.organizationId)).size,
      pausedConnections,
      health,
      rolloutBlock: entry.rolloutBlock ? { ...entry.rolloutBlock } : null,
    };
  });
  return { rows, organizations };
}

/**
 * Who would lose access if `after` replaced the current policy, counting only
 * organizations with a connection (an organization with nothing connected
 * loses nothing it uses). Read-only.
 */
export async function previewAvailabilityImpact(
  prisma: PrismaClient,
  provider: IntegrationProvider,
  change: { policy?: Partial<AvailabilityPolicyFields>; removeOrganizationId?: string },
): Promise<AvailabilityImpact> {
  const before = await getIntegrationAvailabilityPolicy(prisma, provider);
  const after: IntegrationAvailabilityPolicy = { ...before, ...(change.policy ?? {}) };
  const [listed, connections] = await Promise.all([
    prisma.integrationBetaAllowlist.findMany({ where: { provider }, select: { organizationId: true } }),
    prisma.integration.findMany({
      where: { provider, status: { not: "disconnected" } },
      select: { organizationId: true, organization: { select: { name: true } } },
    }),
  ]);
  const listedBefore = new Set(listed.map((row) => row.organizationId));
  const listedAfter = new Set(listedBefore);
  if (change.removeOrganizationId) listedAfter.delete(change.removeOrganizationId);

  const losing = new Map<string, { id: string; name: string; connections: number }>();
  for (const row of connections) {
    const had = decideAvailability(before, listedBefore.has(row.organizationId)).available;
    const keeps = decideAvailability(after, listedAfter.has(row.organizationId)).available;
    if (!had || keeps) continue;
    const current = losing.get(row.organizationId) ?? { id: row.organizationId, name: row.organization.name, connections: 0 };
    current.connections += 1;
    losing.set(row.organizationId, current);
  }
  const organizationsLosingAccess = [...losing.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    organizationsLosingAccess,
    connectionsAffected: organizationsLosingAccess.reduce((sum, org) => sum + org.connections, 0),
  };
}

// ---- Writes ------------------------------------------------------------------

/**
 * Applies a policy change as a compare-and-set on `version` (plan 10 §7.3): a
 * concurrent edit made after the operator loaded the row is never silently
 * overwritten (`stale_version`). The seeded row is created first when missing,
 * from the catalog default, inside the same transaction.
 */
export async function updateIntegrationAvailability(
  prisma: PrismaClient,
  params: { actorEmail: string; provider: IntegrationProvider; input: AvailabilityChangeInput },
): Promise<{ changed: boolean; policy: AvailabilityPolicyFields & { version: number } }> {
  const { actorEmail, provider, input } = params;

  return prisma.$transaction(async (tx) => {
    const defaults = defaultAvailabilityPolicy(provider);
    const current = await tx.integrationAvailability.upsert({
      where: { provider },
      create: {
        provider,
        enabled: defaults.enabled,
        releaseStage: defaults.releaseStage,
        betaAccess: defaults.betaAccess,
      },
      update: {},
    });
    if (current.version !== input.expectedVersion) {
      throw new AvailabilityConflictError("stale_version", "Someone changed this integration since you loaded it. Review the current settings and try again.");
    }

    const before: AvailabilityPolicyFields = {
      enabled: current.enabled,
      releaseStage: current.releaseStage,
      betaAccess: current.betaAccess,
      statusMessage: current.statusMessage,
    };
    const after: AvailabilityPolicyFields = { ...before, ...input.changes };
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return { changed: false, policy: { ...before, version: current.version } };
    }
    assertRolloutAllowed(provider, before, after);

    const updated = await tx.integrationAvailability.updateMany({
      where: { provider, version: input.expectedVersion },
      data: { ...after, version: { increment: 1 }, updatedByEmail: actorEmail },
    });
    if (updated.count !== 1) {
      throw new AvailabilityConflictError("stale_version", "Someone changed this integration since you loaded it. Review the current settings and try again.");
    }

    await recordAdminAudit(tx, {
      actorEmail,
      action: "update_integration_availability",
      metadata: { provider, before, after, reason: input.reason } as unknown as Prisma.InputJsonValue,
    });
    return { changed: true, policy: { ...after, version: input.expectedVersion + 1 } };
  });
}

/** Adds one organization to a provider's Beta allowlist. Refused while the provider carries a rollout block. */
export async function addToBetaAllowlist(
  prisma: PrismaClient,
  params: { actorEmail: string; provider: IntegrationProvider; organizationId: string; reason: string },
): Promise<void> {
  const { actorEmail, provider, organizationId, reason } = params;
  const block = catalogEntry(provider).rolloutBlock;
  if (block) throw new AvailabilityConflictError("rollout_blocked", `Blocked by ${block.id}: ${block.reason}`);

  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new AdminNotFoundError("Organization not found");
    const existing = await tx.integrationBetaAllowlist.findUnique({
      where: { provider_organizationId: { provider, organizationId } },
      select: { provider: true },
    });
    if (existing) throw new AvailabilityConflictError("already_listed", "This organization is already on the allowlist");

    await tx.integrationBetaAllowlist.create({ data: { provider, organizationId, addedByEmail: actorEmail } });
    await recordAdminAudit(tx, {
      actorEmail,
      action: "add_integration_allowlist",
      organizationId,
      metadata: { provider, organizationId, reason },
    });
  });
}

/**
 * Removes one organization from a provider's Beta allowlist. Its connection,
 * credentials and data are kept. For Custom REST the same transaction also
 * pauses polling on its custom integration (plan 09 §8.7, unchanged by D33):
 * re-adding it does not resume the pause.
 */
export async function removeFromBetaAllowlist(
  prisma: PrismaClient,
  params: { actorEmail: string; provider: IntegrationProvider; organizationId: string; reason: string; now?: Date },
): Promise<{ pausedPolling: boolean }> {
  const { actorEmail, provider, organizationId, reason } = params;
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const removed = await tx.integrationBetaAllowlist.deleteMany({ where: { provider, organizationId } });
    if (removed.count === 0) throw new AvailabilityConflictError("not_listed", "This organization is not on the allowlist");

    let pausedPolling = false;
    if (provider === "custom") {
      const paused = await tx.integration.updateMany({
        where: { organizationId, provider: "custom", status: { not: "disconnected" }, pollingPausedAt: null },
        data: { pollingPausedAt: now },
      });
      pausedPolling = paused.count > 0;
    }
    await recordAdminAudit(tx, {
      actorEmail,
      action: "remove_integration_allowlist",
      organizationId,
      metadata: { provider, organizationId, reason, pausedPolling },
    });
    return { pausedPolling };
  });
}

/** Maps the errors above to the documented admin API responses; rethrows anything else. */
export function availabilityErrorStatus(error: unknown): { status: number; body: { error: string; code?: string } } {
  if (error instanceof AdminValidationError) return { status: 400, body: { error: error.message } };
  if (error instanceof AdminNotFoundError) return { status: 404, body: { error: error.message } };
  if (error instanceof AvailabilityConflictError) return { status: 409, body: { error: error.message, code: error.code } };
  throw error;
}
