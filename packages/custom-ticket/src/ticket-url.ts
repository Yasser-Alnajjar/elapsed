const MARKER = "\u0001ID\u0001";

function credentialsTemplate(credentials: unknown): string | null {
  const template = (credentials as { ticketUrlTemplate?: unknown } | null | undefined)?.ticketUrlTemplate;
  return typeof template === "string" && (template.match(/\{id\}/g) ?? []).length === 1 ? template : null;
}

/**
 * The owner-supplied ticket-URL template (`https://app.example.com/tickets/{id}`)
 * is used only to recognise and display ticket links (plan 09, 8.1 step 5): the
 * host is matched by exact equality and the id is captured from the path or one
 * query parameter. It is never a request destination.
 */
export function recognizeCustomTicketUrl(url: string, credentials: unknown): string | null {
  const template = credentialsTemplate(credentials);
  if (!template) return null;
  let base: URL;
  let candidate: URL;
  try {
    base = new URL(template.replace("{id}", MARKER));
    candidate = new URL(url);
  } catch {
    return null;
  }
  if (candidate.protocol !== "https:" || base.protocol !== "https:" || candidate.hostname.toLowerCase() !== base.hostname.toLowerCase()) return null;
  if ((candidate.port || "443") !== (base.port || "443") || candidate.username || candidate.password) return null;

  const basePath = decodeURIComponent(base.pathname);
  if (basePath.includes(MARKER)) {
    const [prefix, suffix] = basePath.split(MARKER) as [string, string];
    let path: string;
    try {
      path = decodeURIComponent(candidate.pathname);
    } catch {
      return null;
    }
    if (!path.startsWith(prefix) || !path.endsWith(suffix) || path.length <= prefix.length + suffix.length) return null;
    const id = path.slice(prefix.length, path.length - suffix.length);
    if (id === "" || id.includes("/")) return null;
    return id;
  }
  for (const [key, value] of base.searchParams) {
    if (value !== MARKER) continue;
    if (candidate.pathname !== base.pathname) return null;
    const id = candidate.searchParams.get(key);
    return id === null || id === "" ? null : id;
  }
  return null;
}

/** The link to a ticket in the customer's own helpdesk, or null when no template is stored. */
export function customTicketUrl(externalId: string, credentials: unknown): string | null {
  const template = credentialsTemplate(credentials);
  if (!template) return null;
  try {
    const url = new URL(template.replace("{id}", encodeURIComponent(externalId)));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
