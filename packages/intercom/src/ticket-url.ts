/**
 * The ticket-source URL recognizer for Intercom (N1.13): `url` -> the case's
 * `externalId` (the conversation id), or `null` when the URL is not a
 * conversation in *this* organization's own Intercom workspace. `credentials`
 * is the integration's stored credentials; one whose `workspaceId` has not
 * been recorded yet (the backfill records it from `GET /me`) recognizes
 * nothing, exactly as Zendesk accepts only the org's own subdomain.
 *
 * Accepts only the inbox URL shape this package itself builds
 * (`buildIntercomConversationUrl`, ./client). Other shapes an Intercom -> Jira
 * or Intercom -> Linear integration may write into a remote link (other inbox
 * paths, regional hosts) are deliberately NOT guessed at: each one is added
 * only once a real captured link is stored as a fixture in ../test.
 */
export function recognizeIntercomConversationUrl(url: string, credentials: unknown): string | null {
  const workspaceId = (credentials as { workspaceId?: unknown } | null | undefined)?.workspaceId;
  if (typeof workspaceId !== "string" || workspaceId === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "app.intercom.com") return null;

  const match = parsed.pathname.match(/^\/a\/apps\/([^/]+)\/conversations\/([^/]+)\/?$/);
  if (!match) return null;
  let urlWorkspaceId: string;
  let conversationId: string;
  try {
    urlWorkspaceId = decodeURIComponent(match[1]!);
    conversationId = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  if (urlWorkspaceId !== workspaceId) return null;
  return conversationId === "" ? null : conversationId;
}
