import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getPrismaClient } from "@sla/db";
import { EMAIL_NOT_VERIFIED_ERROR, encodeAuthThrottleError } from "@/lib/auth-rate-limit";
import { clientIpFromHeaders } from "@/lib/rate-limit";
import { assertSessionStillValid } from "@/lib/session-validity";
import {
  checkAuthThrottle,
  clearAuthThrottle,
  normalizeLoginIdentity,
  recordFailedAuthAttempt,
} from "@/lib/auth-throttle";

/**
 * 7 days — was NextAuth's implicit default (30 days) until roadmap 5.7.
 * Shortening it is a second, independent layer on top of
 * `sessionVersion`-based invalidation below: even a token this app never
 * has a reason to invalidate (no password change, account still active)
 * now has a hard ceiling on how long a stolen/leaked session cookie stays
 * usable, instead of a full month.
 */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * A precomputed bcrypt hash of a value nothing will ever type as a real
 * password. Compared against on the "no such user" path below so that
 * branch costs the same bcrypt work as a real wrong-password check —
 * without it, an unrecognized email would return a full compare faster
 * than an existing one, i.e. a response-time oracle for user enumeration
 * (identical return value and error message already prevent enumeration
 * *by content*; this closes the same gap in *timing*). Computed once at
 * module load, same cost factor (12) as `/api/sign-up`'s real hashing.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("no-such-user-placeholder", 12);

/**
 * Client IP from the plain headers object NextAuth hands `authorize()`, with
 * the same right-to-left `X-Forwarded-For` rule as `getClientIp` in
 * `@/lib/rate-limit`.
 */
function getAuthorizeClientIp(headers: Record<string, unknown> | undefined): string {
  const headerValue = (value: unknown) => {
    const joined = Array.isArray(value) ? value.join(",") : value;
    return typeof joined === "string" ? joined : null;
  };
  return clientIpFromHeaders(headerValue(headers?.["x-forwarded-for"]), headerValue(headers?.["x-real-ip"]));
}

/**
 * JWT sessions (not database sessions) — the Credentials provider requires
 * it. `role` (owner/member — see the `User.role` schema doc comment) is
 * carried on the token itself rather than looked up per-request, since it
 * only ever changes at sign-up. `sessionVersion` (roadmap 5.7) is the
 * opposite case — it exists specifically *because* a password change or
 * account removal can happen mid-session and must take effect immediately:
 * the `jwt` callback below re-checks it against the database on every
 * request (not just at sign-in), and next-auth turns a throw from that
 * callback into a cleared session — see `session.js`'s `session()` route
 * handler, which wraps the `callbacks.jwt(...)` call in a `try/catch` and
 * falls back to an empty, cookie-cleared response on any error. This is
 * the actual mechanism (verified against the installed `next-auth@4`
 * source, not just its docs) that makes `assertSessionStillValid` work.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/sign-in" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Progressive throttle for repeated failed attempts (roadmap step 30
        // follow-up) — see `@/lib/auth-throttle`. Checked before any
        // database/password work so a throttled key never gets a real
        // credential check for free.
        //
        // Keyed on normalized email + client IP rather than email alone: an
        // email-only key would let anyone force a cooldown onto another
        // person's account just by failing logins against it from anywhere,
        // which is exactly the DoS-via-throttle this feature must not
        // introduce. Scoping to the caller's own IP as well means a stranger
        // can only ever throttle *their own* attempts against that email —
        // never the real owner's, who logs in from a different IP.
        // The DB lookup key below stays the bare normalized email; only the
        // throttle is scoped to the IP.
        const identity = normalizeLoginIdentity(credentials.email);
        const throttleKey = `${identity}:${getAuthorizeClientIp(req?.headers)}`;
        const throttle = checkAuthThrottle(throttleKey);
        if (throttle.throttled) {
          throw new Error(encodeAuthThrottleError(throttle.retryAfterSeconds ?? 60));
        }

        const prisma = getPrismaClient();
        const user = await prisma.user.findUnique({
          where: { email: identity },
        });
        if (!user) {
          // Same return value, same error message, and — via the dummy
          // compare above — the same rough latency as a wrong password:
          // an unrecognized email must be indistinguishable from an
          // existing one with the wrong password, or it becomes a
          // user-enumeration oracle.
          await bcrypt.compare(credentials.password, DUMMY_PASSWORD_HASH);
          recordFailedAuthAttempt(throttleKey);
          return null;
        }

        const valid = await bcrypt.compare(
          credentials.password,
          user.passwordHash,
        );
        if (!valid) {
          recordFailedAuthAttempt(throttleKey);
          return null;
        }

        clearAuthThrottle(throttleKey);

        // Email verification gate — the server-side enforcement point for
        // sign-in (the UI only reflects it). Checked *after* the password so
        // that "this account exists and is unverified" is only ever revealed
        // to someone who already holds the right password, never to a
        // stranger probing an address (same enumeration concern as the
        // dummy compare above). Throwing, rather than returning `null`, is
        // what lets the client tell this apart from a wrong password;
        // crucially, NextAuth never reaches its `jwt` callback or sets a
        // session cookie when `authorize()` throws, so an unverified user is
        // never issued a token. `assertSessionStillValid` is the second layer
        // for tokens that already exist.
        if (!user.emailVerifiedAt) {
          throw new Error(EMAIL_NOT_VERIFIED_ERROR);
        }

        return {
          id: user.id,
          email: user.email,
          emailVerifiedAt: user.emailVerifiedAt,
          name: user.name ?? null,
          image: user.image ?? null,
          organizationId: user.organizationId,
          role: user.role,
          sessionVersion: user.sessionVersion,
          createdAt: user.createdAt,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = user.id;
        token.organizationId = user.organizationId;
        token.role = user.role;
        token.sessionVersion = user.sessionVersion;
      } else {
        // Every call after the initial sign-in (roadmap 5.7) — re-checked
        // against the database on each one, not cached for the token's
        // lifetime, so a password change or removal takes effect on this
        // session's very next request rather than waiting for
        // `SESSION_MAX_AGE_SECONDS` to elapse. Throwing here is the
        // deliberate signal — see this file's `authOptions` doc comment.
        await assertSessionStillValid(getPrismaClient(), token);
      }
      // NextAuth's core seeds `token.picture` from `user.image` itself
      // before this callback runs (see `defaultToken` in
      // next-auth/core/routes/callback.js), independent of anything we do
      // above. Avatars are stored as `data:` URLs up to 500KB (see
      // `updateProfileSchema`), and a JWT this app doesn't chunk across
      // multiple cookies is the wrong place for one — it bloats the session
      // cookie past safe header-size limits, which breaks `/api/auth/session`
      // for any user with an avatar set. The sidebar avatar instead reads
      // straight from the database on every request — see
      // `(main)/layout.tsx` — so the JWT never needs it.
      token.picture = null;
      // Fired by the client's `useSession().update(...)` (see the Profile
      // page) right after `/api/me` saves a name change — merges it into
      // this JWT cookie so `useSession()` reflects the edit without a full
      // re-login. Deliberately excludes the avatar for the same reason as
      // above.
      if (trigger === "update" && session) {
        if (typeof session.name === "string") token.name = session.name;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId;
      session.user.organizationId = token.organizationId;
      session.user.role = token.role;
      return session;
    },
  },
};
