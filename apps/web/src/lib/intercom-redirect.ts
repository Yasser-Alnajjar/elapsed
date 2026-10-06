import { getAppUrl } from "@/lib/app-url";

/**
 * The Intercom callback URL for this deployment, anchored to `NEXTAUTH_URL`
 * like every other provider's. It must also be registered on the app in
 * Intercom's Developer Hub — Intercom rejects a `redirect_uri` it doesn't
 * know. Kept apart from `intercom-env.ts` so the docs page can show it
 * without importing the database client.
 */
export function getIntercomRedirectUri(): string {
  return `${getAppUrl()}/api/integrations/intercom/callback`;
}
