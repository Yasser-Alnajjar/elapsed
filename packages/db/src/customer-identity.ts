import { isUniqueConstraintError } from "./prisma-errors";
import type { Customer, IntegrationProvider, PrismaClient } from "../generated/prisma/client";

/**
 * Provider-neutral Customer resolution (N1.14).
 *
 * A provider names a Customer by an *identity* — (provider, kind, externalId),
 * e.g. a Zendesk `organization` or an Intercom `company` — stored as a
 * `CustomerIdentity` row. Customers are resolved and created through these
 * helpers; `Customer` itself carries no provider columns (dropped in N2.10).
 */
export interface CustomerIdentityRef {
  organizationId: string;
  provider: IntegrationProvider;
  /** Adapter-defined: "organization", "company", "contact". */
  kind: string;
  externalId: string;
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
  return identity?.customer ?? null;
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
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await findCustomerByIdentity(prisma, ref);
    if (!winner) throw error;
    return winner;
  }
}
