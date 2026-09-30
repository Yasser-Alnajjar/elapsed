import { Prisma } from "../generated/prisma/client";
import type { Customer, IntegrationProvider, PrismaClient } from "../generated/prisma/client";

/**
 * Provider-neutral Customer resolution (N1.14).
 *
 * A provider names a Customer by an *identity* — (provider, kind, externalId),
 * e.g. a Zendesk `organization` or an Intercom `company` — stored as a
 * `CustomerIdentity` row. Adapters resolve and create customers through these
 * helpers instead of through one column per provider on `Customer`.
 *
 * `legacy` is the matching legacy column (`zendeskOrgId`, `intercomCompanyId`,
 * `intercomContactId`). It is dual-written for one release so a code rollback
 * still finds its customers, and read as a fallback so a customer created by
 * rolled-back code (no identity row) is adopted rather than duplicated. Both
 * go away in N2.10.
 */
export interface CustomerIdentityRef {
  organizationId: string;
  provider: IntegrationProvider;
  /** Adapter-defined: "organization", "company", "contact". */
  kind: string;
  externalId: string;
  /** The legacy Customer column dual-written alongside the identity row. */
  legacy: { zendeskOrgId: string } | { intercomCompanyId: string } | { intercomContactId: string };
}

type Client = Pick<PrismaClient, "customer" | "customerIdentity">;

function identityKey({ organizationId, provider, kind, externalId }: CustomerIdentityRef) {
  return { organizationId_provider_kind_externalId: { organizationId, provider, kind, externalId } };
}

/** Returns the customer this identity names in the organization, or null. */
export async function findCustomerByIdentity(prisma: Client, ref: CustomerIdentityRef): Promise<Customer | null> {
  const identity = await prisma.customerIdentity.findUnique({
    where: identityKey(ref),
    include: { customer: true },
  });
  if (identity) return identity.customer;

  // No identity row: a customer written by pre-N1.14 code (after a rollback).
  // Adopt it so the two stores converge.
  const legacyCustomer = await prisma.customer.findFirst({
    where: { organizationId: ref.organizationId, ...ref.legacy },
  });
  if (!legacyCustomer) return null;
  await createIdentity(prisma, legacyCustomer.id, ref);
  return legacyCustomer;
}

/**
 * Finds the customer for an identity and refreshes its name, or creates the
 * customer together with the identity row. Safe under concurrent normalization:
 * a unique-constraint loss re-reads the winner's row.
 */
export async function upsertCustomerByIdentity(
  prisma: Client,
  ref: CustomerIdentityRef,
  name: string,
): Promise<Customer> {
  const existing = await findCustomerByIdentity(prisma, ref);
  if (existing) {
    return existing.name === name ? existing : prisma.customer.update({ where: { id: existing.id }, data: { name } });
  }
  try {
    return await prisma.customer.create({
      data: {
        organizationId: ref.organizationId,
        name,
        ...ref.legacy,
        identities: {
          create: {
            organizationId: ref.organizationId,
            provider: ref.provider,
            kind: ref.kind,
            externalId: ref.externalId,
          },
        },
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findCustomerByIdentity(prisma, ref);
    if (!winner) throw error;
    return winner;
  }
}

async function createIdentity(prisma: Client, customerId: string, ref: CustomerIdentityRef) {
  try {
    await prisma.customerIdentity.create({
      data: {
        organizationId: ref.organizationId,
        customerId,
        provider: ref.provider,
        kind: ref.kind,
        externalId: ref.externalId,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
