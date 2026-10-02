import "server-only";
import type { Session } from "next-auth";
import { notFound } from "next/navigation";
import { isPlatformOperator } from "./authz";
import { getRequestContext } from "./request-context";

/**
 * Gate for every `/admin` page and every server-side admin read (N4.1).
 * `notFound()` rather than a 403 page for anyone who is not a platform
 * operator: the route does not exist for them, the same way a member gets
 * `notFound()` on another organization's case. API routes use
 * `requirePlatformOperator` (401/403) instead.
 *
 * Returns the operator's email, which is what the audit log records. A user
 * who is not signed in is redirected to sign-in by `getRequestContext`.
 */
export async function requirePlatformAdminPage(): Promise<{ session: Session; actorEmail: string }> {
  const { session } = await getRequestContext();
  if (!isPlatformOperator(session)) notFound();
  return { session, actorEmail: session.user.email.toLowerCase() };
}
