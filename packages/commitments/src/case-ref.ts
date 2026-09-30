import type { IntegrationProvider, PrismaClient } from "@sla/db";

/**
 * A ticket source's URL recognizer: `url` -> the `Case.externalId` it points
 * at, or `null` when the URL is not one of this organization's own tickets.
 * `credentials` is that integration's stored credentials. Implemented by each
 * ticket-source adapter (`@sla/zendesk`, `@sla/intercom`); this package
 * imports none of them, the caller passes them in.
 */
export type TicketUrlRecognizer = (url: string, credentials: unknown) => string | null;

/** What an external URL (a Jira remote link, a Linear attachment) points at. */
export type CaseRefResolution =
  | { kind: "case"; caseId: string }
  /** No connected ticket source recognizes the URL as its own. */
  | { kind: "unrecognized" }
  /** A source recognized it, but that source has no live case for the id. */
  | { kind: "no_case" };

export type CaseRefResolver = (url: string) => Promise<CaseRefResolution>;

/**
 * Builds, for one organization, the function that turns an external URL into
 * one of its cases (N1.13). `recognizers` maps a provider name to that
 * provider's `TicketUrlRecognizer`; only organizations' integrations whose
 * provider has an entry take part. A recognized id resolves to a case only
 * when the case was created by that same provider (`Case.system`), so a
 * Zendesk ticket id can never land on an Intercom conversation that happens
 * to share it.
 *
 * Returns `null` when the organization has no such integration, so the
 * trackers can skip correlation outright, as they did without a Zendesk
 * integration before.
 */
export async function buildCaseRefResolver(
  prisma: PrismaClient,
  organizationId: string,
  recognizers: Readonly<Record<string, TicketUrlRecognizer>>,
): Promise<CaseRefResolver | null> {
  const integrations = await prisma.integration.findMany({
    where: { organizationId, provider: { in: Object.keys(recognizers) as IntegrationProvider[] } },
    select: { provider: true, credentials: true },
  });
  if (integrations.length === 0) return null;

  return async (url) => {
    for (const { provider, credentials } of integrations) {
      const externalId = recognizers[provider]?.(url, credentials);
      if (externalId == null) continue;

      const caseRow = await prisma.case.findUnique({
        where: { organizationId_externalId: { organizationId, externalId } },
        select: { id: true, system: true, deletedAt: true },
      });
      if (!caseRow || caseRow.deletedAt || caseRow.system !== provider) return { kind: "no_case" };
      return { kind: "case", caseId: caseRow.id };
    }
    return { kind: "unrecognized" };
  };
}
