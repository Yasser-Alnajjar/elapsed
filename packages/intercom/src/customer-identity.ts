import type { CustomerIdentityRef } from "@sla/ingestion";

/** An Intercom company is the primary identity of a Customer (N1.14). */
export function intercomCompanyIdentity(companyId: string): CustomerIdentityRef {
  return { provider: "intercom", kind: "company", externalId: companyId };
}

/** A company-less contact is the fallback identity of a Customer (N1.14). */
export function intercomContactIdentity(contactId: string): CustomerIdentityRef {
  return { provider: "intercom", kind: "contact", externalId: contactId };
}
