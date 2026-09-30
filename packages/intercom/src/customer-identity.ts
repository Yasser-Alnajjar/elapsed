import type { CustomerIdentityRef } from "@sla/db";

/** An Intercom company is the primary identity of a Customer (N1.14). */
export function intercomCompanyIdentity(organizationId: string, companyId: string): CustomerIdentityRef {
  return {
    organizationId,
    provider: "intercom",
    kind: "company",
    externalId: companyId,
    legacy: { intercomCompanyId: companyId },
  };
}

/** A company-less contact is the fallback identity of a Customer (N1.14). */
export function intercomContactIdentity(organizationId: string, contactId: string): CustomerIdentityRef {
  return {
    organizationId,
    provider: "intercom",
    kind: "contact",
    externalId: contactId,
    legacy: { intercomContactId: contactId },
  };
}
