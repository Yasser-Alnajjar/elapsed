import type { Session } from "next-auth";
import { NextResponse } from "next/server";

/**
 * Emails of the platform operators who run this deployment — not an
 * organization role (see `UserRole`; no tenant, including an org owner, is
 * ever a platform operator). Comma-separated, matched case-insensitively.
 */
function platformAdminEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlatformOperator(session: Session | null): boolean {
  if (!session) return false;
  return platformAdminEmails().has(session.user.email.toLowerCase());
}

/**
 * Gate for the operator-only Worker/Monitoring settings — global, shared by
 * every organization on the deployment, see `@sla/db`'s `WorkerSettings` doc
 * comment. Only a platform operator (`PLATFORM_ADMIN_EMAILS`) may read or
 * write them; every tenant, including an org owner, is denied. This is a separate axis from `UserRole` —
 * the platform operator stays configured only through the environment,
 * never as an organization role (see `requireOwner` for that axis).
 */
export function requirePlatformOperator(session: Session | null): NextResponse | null {
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isPlatformOperator(session)) {
    return NextResponse.json({ error: "Only a platform operator can access this" }, { status: 403 });
  }
  return null;
}

/**
 * Gate for organization-owner-only mutations (task 5.4's authorization
 * audit): configuration, integrations, SMTP, policies, calendars, and
 * members. Every read (GET/list) stays open to any signed-in member — they
 * need to see this configuration to work cases — only mutations are gated.
 * Callers check the session for `null`/unauthenticated themselves first
 * (same convention as `requirePlatformOperator`); this only decides the
 * owner-vs-member question for an already-established session.
 */
export function requireOwner(session: Session | null): NextResponse | null {
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Only an organization owner can change this setting" }, { status: 403 });
  }
  return null;
}
