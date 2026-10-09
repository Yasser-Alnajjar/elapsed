import type {
  IntegrationBetaAccess,
  IntegrationProvider,
  IntegrationReleaseStage,
  Prisma,
} from "../generated/prisma/client";
import { CATALOG_PROVIDERS, INTEGRATION_CATALOG } from "./integration-catalog";

/**
 * Platform-level integration availability (D33, plan 10 §5.1): the one
 * question every provider path asks, "may this organization use this provider
 * now?". Every call reads the database (no cache), so a change an operator
 * makes is observed by the next check in every web and worker process without
 * any other infrastructure.
 *
 * Availability never changes an `Integration` row: a provider that is
 * unavailable is distinct from a customer's own disconnect.
 */

/** The documented refusal codes (plan 10 §4.1), returned to API consumers as `code`. */
export const INTEGRATION_UNAVAILABLE_CODES = [
  "integration_disabled",
  "integration_coming_soon",
  "integration_beta_restricted",
] as const;
export type IntegrationUnavailableCode = (typeof INTEGRATION_UNAVAILABLE_CODES)[number];

export const isIntegrationUnavailableCode = (value: unknown): value is IntegrationUnavailableCode =>
  typeof value === "string" && (INTEGRATION_UNAVAILABLE_CODES as readonly string[]).includes(value);

/** The persisted policy for one provider, or the catalog default when it has no row yet. */
export interface IntegrationAvailabilityPolicy {
  provider: IntegrationProvider;
  enabled: boolean;
  releaseStage: IntegrationReleaseStage;
  betaAccess: IntegrationBetaAccess;
  statusMessage: string | null;
  /** Optimistic-concurrency version; 0 for a default that has never been written. */
  version: number;
  /** Null for a catalog default. */
  updatedAt: Date | null;
  updatedByEmail: string | null;
}

export type IntegrationAvailabilityDecision =
  | { available: true; provider: IntegrationProvider; releaseStage: IntegrationReleaseStage }
  | {
      available: false;
      provider: IntegrationProvider;
      releaseStage: IntegrationReleaseStage;
      code: IntegrationUnavailableCode;
      /** A fixed sentence fit for a customer; never contains anything secret. */
      message: string;
      /** The operator's customer-facing note, when set. */
      statusMessage: string | null;
    };

/** Thrown by provider code paths that are not HTTP routes (worker, packages) when a provider is unavailable. */
export class IntegrationUnavailableError extends Error {
  constructor(
    readonly provider: IntegrationProvider,
    readonly code: IntegrationUnavailableCode,
  ) {
    super(unavailableMessage(provider, code));
    this.name = "IntegrationUnavailableError";
  }
}

/** Anything with the two delegates: the client, or a `$transaction` client. */
export type AvailabilityDb = Pick<Prisma.TransactionClient, "integrationAvailability" | "integrationBetaAllowlist">;

export function unavailableMessage(provider: IntegrationProvider, code: IntegrationUnavailableCode): string {
  const name = INTEGRATION_CATALOG[provider].name;
  switch (code) {
    case "integration_disabled":
      return `${name} is temporarily unavailable. Your existing data is kept.`;
    case "integration_coming_soon":
      return `${name} is coming soon and can't be connected yet.`;
    case "integration_beta_restricted":
      return `${name} is in Beta and not enabled for this organization.`;
  }
}

export function defaultAvailabilityPolicy(provider: IntegrationProvider): IntegrationAvailabilityPolicy {
  return {
    provider,
    ...INTEGRATION_CATALOG[provider].defaults,
    statusMessage: null,
    version: 0,
    updatedAt: null,
    updatedByEmail: null,
  };
}

type PolicyRow = Omit<IntegrationAvailabilityPolicy, "updatedAt"> & { updatedAt: Date };

function toPolicy(row: PolicyRow): IntegrationAvailabilityPolicy {
  return {
    provider: row.provider,
    enabled: row.enabled,
    releaseStage: row.releaseStage,
    betaAccess: row.betaAccess,
    statusMessage: row.statusMessage,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedByEmail: row.updatedByEmail,
  };
}

/** Whether a policy needs an allowlist lookup to decide. */
export const policyUsesAllowlist = (policy: IntegrationAvailabilityPolicy): boolean =>
  policy.enabled && policy.releaseStage === "beta" && policy.betaAccess === "allowlist";

/** The pure decision (plan 10 §4.1). `onAllowlist` matters only when `policyUsesAllowlist`. */
export function decideAvailability(policy: IntegrationAvailabilityPolicy, onAllowlist: boolean): IntegrationAvailabilityDecision {
  const base = { provider: policy.provider, releaseStage: policy.releaseStage };
  const refuse = (code: IntegrationUnavailableCode): IntegrationAvailabilityDecision => ({
    ...base,
    available: false,
    code,
    message: unavailableMessage(policy.provider, code),
    statusMessage: policy.statusMessage,
  });
  if (!policy.enabled) return refuse("integration_disabled");
  if (policy.releaseStage === "coming_soon") return refuse("integration_coming_soon");
  if (policyUsesAllowlist(policy) && !onAllowlist) return refuse("integration_beta_restricted");
  return { ...base, available: true };
}

export async function getIntegrationAvailabilityPolicy(
  db: AvailabilityDb,
  provider: IntegrationProvider,
): Promise<IntegrationAvailabilityPolicy> {
  const row = await db.integrationAvailability.findUnique({ where: { provider } });
  return row ? toPolicy(row) : defaultAvailabilityPolicy(provider);
}

/** Every provider's policy, in catalog order. */
export async function listIntegrationAvailabilityPolicies(db: AvailabilityDb): Promise<IntegrationAvailabilityPolicy[]> {
  const rows = await db.integrationAvailability.findMany();
  const byProvider = new Map(rows.map((row) => [row.provider, toPolicy(row)]));
  return CATALOG_PROVIDERS.map((provider) => byProvider.get(provider) ?? defaultAvailabilityPolicy(provider));
}

/** May this organization use this provider now? One or two primary-key reads. */
export async function resolveIntegrationAvailability(
  db: AvailabilityDb,
  organizationId: string,
  provider: IntegrationProvider,
): Promise<IntegrationAvailabilityDecision> {
  const policy = await getIntegrationAvailabilityPolicy(db, provider);
  const onAllowlist = policyUsesAllowlist(policy)
    ? (await db.integrationBetaAllowlist.findUnique({
        where: { provider_organizationId: { provider, organizationId } },
        select: { provider: true },
      })) !== null
    : false;
  return decideAvailability(policy, onAllowlist);
}

/** Every provider's decision for one organization, in two queries (worker runs, selectors). */
export async function resolveOrganizationAvailability(
  db: AvailabilityDb,
  organizationId: string,
): Promise<Record<IntegrationProvider, IntegrationAvailabilityDecision>> {
  const [policies, allowlisted] = await Promise.all([
    listIntegrationAvailabilityPolicies(db),
    db.integrationBetaAllowlist.findMany({ where: { organizationId }, select: { provider: true } }),
  ]);
  const onList = new Set(allowlisted.map((row) => row.provider));
  return Object.fromEntries(
    policies.map((policy) => [policy.provider, decideAvailability(policy, onList.has(policy.provider))]),
  ) as Record<IntegrationProvider, IntegrationAvailabilityDecision>;
}

/** Throws `IntegrationUnavailableError` unless the provider is available to the organization. */
export async function assertIntegrationAvailable(
  db: AvailabilityDb,
  organizationId: string,
  provider: IntegrationProvider,
): Promise<void> {
  const decision = await resolveIntegrationAvailability(db, organizationId, provider);
  if (!decision.available) throw new IntegrationUnavailableError(provider, decision.code);
}
