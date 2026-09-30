import type { CustomerIdentityRef } from "@sla/db";

/** A Zendesk organization is the identity of a Customer (N1.14). */
export function zendeskOrganizationIdentity(organizationId: string, zendeskOrgId: number | string): CustomerIdentityRef {
  return {
    organizationId,
    provider: "zendesk",
    kind: "organization",
    externalId: String(zendeskOrgId),
    legacy: { zendeskOrgId: String(zendeskOrgId) },
  };
}
