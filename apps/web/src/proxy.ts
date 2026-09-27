import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { encodeCredentialsRateLimitError } from "@/lib/auth-rate-limit";
import { isSameOriginRequest, isStateChangingMethod } from "@/lib/csrf";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Pages anyone can reach with no session: the docs site, the two auth
 * screens, the invitation-accept page (its token, not a session, is
 * the credential — roadmap 5.2), the forgot/reset-password pages (same
 * token-is-the-credential shape — roadmap 5.5), the verify-email page
 * (roadmap 5.6, same shape again — opened from an email client that may
 * not share a browser with any signed-in session), and the terms/privacy
 * pages (legal pages, linked from the site footer and sign-up flow).
 * Everything else under the app (dashboard, cases, settings, onboarding,
 * and their API routes) requires a signed-in user.
 */
const PUBLIC_PAGE_PATHS = [
  "/",
  "/docs",
  "/about",
  "/pricing",
  "/invite",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/terms",
  "/privacy",
];
const AUTH_PAGE_PATHS = ["/sign-in", "/sign-up"];

/**
 * API routes that authenticate themselves rather than via the session
 * cookie: NextAuth's own endpoints (the login mechanism itself), account
 * creation, inbound provider webhooks (Zendesk/Jira call these directly and
 * carry their own bearer token/secret, never a browser session), the
 * invitation-accept endpoint (the invitation token itself is the
 * credential — roadmap 5.2; note this is distinct from
 * `/api/settings/invitations`, which manages invitations and stays
 * session-gated like every other settings route), the password-reset
 * endpoints (same token-is-the-credential shape — roadmap 5.5; distinct
 * from `/api/me/password`, the authenticated change-password route, which
 * stays session-gated), the email-verification confirm endpoint (same
 * shape again — roadmap 5.6; distinct from `/api/me/email` and
 * `/api/me/resend-verification`, which request/resend a token and stay
 * session-gated), and the health check (an uptime monitor or container
 * orchestrator has no session cookie either, and needs no org context — it
 * only checks DB connectivity).
 */
const PUBLIC_API_PATHS = [
  "/api/auth",
  "/api/sign-up",
  "/api/webhooks",
  "/api/invitations",
  "/api/password-reset",
  "/api/email-verification",
  "/api/health",
];

function matchesPath(pathname: string, paths: string[]): boolean {
  return paths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Rate limits scoped to exactly the unauthenticated-by-session routes named
 * in roadmap step 30: the two webhook receivers (external providers call
 * these directly, at low legitimate volume, so a generous cap mostly just
 * slows down secret-guessing), account creation, and the credentials
 * sign-in callback (NextAuth's Credentials provider has no throttling of
 * its own). `/api/auth`'s other paths — session/csrf/providers lookups the
 * client calls on every page load — are deliberately left unthrottled here.
 */
interface RateLimitRule {
  match: (pathname: string) => boolean;
  bucket: string;
  limit: number;
  windowMs: number;
  /**
   * Only the credentials callback needs this: `next-auth/react`'s `signIn()`
   * always reads `error` out of a `url` field on the response body (see
   * `@/lib/auth-rate-limit`'s doc comment), so a generic `{ error }` body
   * would make its internal `new URL(data.url)` call throw. Defaults to the
   * plain body every other rate-limited route uses.
   */
  buildBody?: (
    request: NextRequest,
    retryAfterSeconds: number,
  ) => Record<string, unknown>;
}

const RATE_LIMITS: RateLimitRule[] = [
  {
    match: (p) => matchesPath(p, ["/api/webhooks"]),
    bucket: "webhook",
    limit: 60,
    windowMs: 60_000,
  },
  {
    match: (p) => p === "/api/sign-up",
    bucket: "sign-up",
    limit: 5,
    windowMs: 15 * 60_000,
  },
  {
    match: (p) => matchesPath(p, ["/api/invitations/accept"]),
    bucket: "invitation-accept",
    limit: 20,
    windowMs: 15 * 60_000,
  },
  {
    // Requesting a reset always returns the same `{ ok: true }` (no
    // enumeration signal), so this cap exists only to stop the route from
    // being used to spam an arbitrary inbox with reset emails.
    match: (p) => p === "/api/password-reset",
    bucket: "password-reset-request",
    limit: 5,
    windowMs: 15 * 60_000,
  },
  {
    // The token itself already carries 256 bits of entropy (see
    // `@sla/db`'s `secure-token.ts`) — this is defense-in-depth against
    // guessing, not the primary protection.
    match: (p) => p === "/api/password-reset/confirm",
    bucket: "password-reset-confirm",
    limit: 20,
    windowMs: 15 * 60_000,
  },
  {
    // Same defense-in-depth posture as password-reset-confirm.
    match: (p) => p === "/api/email-verification/confirm",
    bucket: "email-verification-confirm",
    limit: 20,
    windowMs: 15 * 60_000,
  },
  {
    match: (p) => p === "/api/auth/callback/credentials",
    bucket: "sign-in",
    limit: 10,
    windowMs: 2 * 60_000,
    buildBody: (request, retryAfterSeconds) => {
      const url = new URL(request.url);
      url.search = new URLSearchParams({
        error: encodeCredentialsRateLimitError(retryAfterSeconds),
      }).toString();
      return { url: url.toString() };
    },
  },
];

/**
 * `/api/webhooks/{provider}/{integrationId}` — matches both webhook
 * receivers' route shape (see `apps/web/src/app/api/webhooks/{zendesk,jira}/
 * [integrationId]/route.ts`). Keying the "webhook" bucket by this instead of
 * the caller's IP (roadmap task 2.5) means one noisy or malicious Zendesk/
 * Jira integration can no longer exhaust the shared budget for every other
 * integration a customer might be calling from the same egress IP (a
 * concern for on-prem Jira in particular, which can share an IP across many
 * tenants) — and, in the other direction, a burst of deliveries for many
 * different integrations from the same provider can no longer share one
 * bucket just because they came from the same IP. Falls back to IP-keying
 * when the path doesn't match this shape (defensive only — the bucket only
 * ever matches `/api/webhooks/**` to begin with).
 */
const WEBHOOK_INTEGRATION_ID_PATTERN = /^\/api\/webhooks\/[^/]+\/([^/]+)/;

function rateLimitKey(rule: RateLimitRule, pathname: string, request: NextRequest): string {
  if (rule.bucket === "webhook") {
    const integrationId = pathname.match(WEBHOOK_INTEGRATION_ID_PATTERN)?.[1];
    if (integrationId) return `${rule.bucket}:${integrationId}`;
  }
  return `${rule.bucket}:${getClientIp(request)}`;
}

/**
 * API routes exempt from the Origin check (roadmap step 33). Webhooks are
 * called server-to-server by Zendesk/Jira with no `Origin` header and no
 * session cookie — they authenticate via their own secret. NextAuth's
 * endpoints already enforce their own double-submit CSRF token. Every other
 * state-changing `/api` request — `/api/settings/**`, integration
 * config/disconnect/backfill, Slack channel selection, and sign-up — is
 * session-cookie (or login) driven and must come from this app's own origin.
 */
const CSRF_EXEMPT_API_PATHS = ["/api/webhooks", "/api/auth"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const rateLimit = RATE_LIMITS.find((rule) => rule.match(pathname));
  if (rateLimit) {
    const key = rateLimitKey(rateLimit, pathname, request);
    const result = checkRateLimit(key, rateLimit.limit, rateLimit.windowMs);
    if (!result.allowed) {
      const retryAfterSeconds = result.retryAfterSeconds ?? 60;
      const body = rateLimit.buildBody?.(request, retryAfterSeconds) ?? {
        error: "Too many requests",
      };
      return NextResponse.json(body, {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }
  }

  if (
    pathname.startsWith("/api/") &&
    isStateChangingMethod(request.method) &&
    !matchesPath(pathname, CSRF_EXEMPT_API_PATHS) &&
    !isSameOriginRequest(request, process.env.NEXTAUTH_URL)
  ) {
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  }

  if (
    matchesPath(pathname, PUBLIC_API_PATHS) ||
    matchesPath(pathname, PUBLIC_PAGE_PATHS)
  ) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (matchesPath(pathname, AUTH_PAGE_PATHS)) {
    // A signed-in user doesn't need the sign-in/sign-up screens again.
    if (token) return NextResponse.redirect(new URL("/dashboard", getAppUrl()));
    return NextResponse.next();
  }

  if (token) return NextResponse.next();

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const signInUrl = new URL("/sign-in", getAppUrl());
  signInUrl.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
