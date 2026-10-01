import type { CustomerIdentityRef } from "@sla/ingestion";

/** A Zendesk organization is the identity of a Customer (N1.14). */
export function zendeskOrganizationIdentity(zendeskOrgId: number | string): CustomerIdentityRef {
  return { provider: "zendesk", kind: "organization", externalId: String(zendeskOrgId) };
}
