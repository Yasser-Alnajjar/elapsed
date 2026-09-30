/**
 * Extracts a Zendesk ticket id from a URL, but only when the host is exactly
 * `{subdomain}.zendesk.com` — a link to some other tenant's Zendesk (or a
 * lookalike domain) must never correlate, per Phase 15's deterministic-tier
 * rule: never confidently invent a relationship.
 */
export function parseZendeskTicketId(url: string, subdomain: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== `${subdomain.toLowerCase()}.zendesk.com`) return null;

  const match = parsed.pathname.match(/\/(?:agent\/tickets|tickets|requests|api\/v2\/tickets)\/(\d+)(?:\.json)?\/?$/);
  return match ? match[1]! : null;
}

/**
 * The ticket-source URL recognizer for Zendesk (N1.13): `url` -> the case's
 * `externalId` (the ticket id), or `null` when the URL is not a ticket on
 * *this* organization's own Zendesk subdomain. `credentials` is the
 * integration's stored credentials; one without a subdomain recognizes
 * nothing. Trackers (Jira, Linear) call this through a resolver built by the
 * caller and never learn what a Zendesk URL looks like.
 */
export function recognizeZendeskTicketUrl(url: string, credentials: unknown): string | null {
  const subdomain = (credentials as { subdomain?: unknown } | null | undefined)?.subdomain;
  if (typeof subdomain !== "string" || subdomain === "") return null;
  return parseZendeskTicketId(url, subdomain);
}
