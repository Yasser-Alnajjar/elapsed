/**
 * End-to-end email verification gate (roadmap 5.6): register -> sign-in
 * refused while unverified -> resend -> verify -> sign-in succeeds, plus the
 * invalid / expired / already-used token cases and the "session minted
 * before the gate existed" case.
 *
 * Nothing here is mocked except the outgoing mail transport (captured so the
 * test can read the link the user would click). The real `POST /api/sign-up`,
 * `/api/email-verification/{resend,confirm}` route handlers run against a
 * real Postgres, and sign-in goes through NextAuth's real engine
 * (`AuthHandler` — the same function the `/api/auth/[...nextauth]` route and
 * `getServerSession` both call) with a real CSRF token, real credentials
 * provider, real JWT encode/decode. That is what lets this assert the claim
 * that matters: an unverified account is never handed a session cookie, and
 * a session cookie for an account that is (or becomes) unverified stops
 * resolving to a user.
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import { createRequire } from "node:module";
import path from "node:path";
import type { PrismaClient } from "@sla/db";
import { renderEmail, type EmailRequest } from "@sla/email";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGINAL_ENV = {
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
};

const mail = vi.hoisted(() => ({ sent: [] as { to: string[]; subject: string; text: string }[] }));
vi.mock("@/lib/transactional-email", () => ({
  // Renders the real template, so the link in the "inbox" is what the layout produced.
  sendTransactionalEmail: vi.fn(async (request: EmailRequest) => {
    const { subject, text } = renderEmail(request);
    mail.sent.push({ to: [...request.to], subject, text });
  }),
}));

const PASSWORD = "correct-horse-battery";

interface Cookie {
  name: string;
  value: string;
}

describe.skipIf(!TEST_DATABASE_URL)("email verification gate (real Postgres + real NextAuth engine)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");
  let authOptions: typeof import("../src/lib/auth").authOptions;
  let authHandler: (params: unknown) => Promise<{
    status?: number;
    body?: Record<string, unknown>;
    redirect?: string;
    cookies?: Cookie[];
  }>;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    process.env.NEXTAUTH_SECRET = "test-secret-for-email-verification-flow";

    db = await import("@sla/db");
    prisma = db.getPrismaClient();
    ({ authOptions } = await import("../src/lib/auth"));

    // `next-auth/core` isn't in the package's `exports` map; load it by
    // absolute path (it's the engine behind both the route handler and
    // `getServerSession`).
    const require = createRequire(import.meta.url);
    const corePath = path.join(path.dirname(require.resolve("next-auth")), "core", "index.js");
    authHandler = require(corePath).AuthHandler;
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    mail.sent.length = 0;
    (await import("../src/lib/rate-limit"))._resetRateLimitState();
    (await import("../src/lib/auth-throttle"))._resetAuthThrottleState();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // --- helpers ------------------------------------------------------------

  const jsonPost = (url: string, body: unknown) =>
    new Request(`http://localhost:3000${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  async function signUp(email: string) {
    const { POST } = await import("../src/app/api/sign-up/route");
    const response = await POST(jsonPost("/api/sign-up", { organizationName: "Acme", email, password: PASSWORD }));
    expect(response.status).toBe(200);
    // The send is fire-and-forget; wait for it.
    await vi.waitFor(() => expect(mail.sent.length).toBeGreaterThanOrEqual(1));
    return mail.sent.at(-1)!;
  }

  const tokenFrom = (message: { text: string }) => {
    const match = /\/verify-email\?token=([^\s]+)/.exec(message.text);
    if (!match) throw new Error(`no verification link in email: ${message.text}`);
    return decodeURIComponent(match[1]!);
  };

  async function confirm(token: string) {
    const { POST } = await import("../src/app/api/email-verification/confirm/route");
    return POST(jsonPost("/api/email-verification/confirm", { token }));
  }

  async function resend(email: string) {
    const { POST } = await import("../src/app/api/email-verification/resend/route");
    return POST(jsonPost("/api/email-verification/resend", { email }));
  }

  /** Mirrors what `next-auth/react`'s `signIn("credentials", { redirect: false })` sends. */
  async function signIn(email: string, password: string) {
    const csrf = await authHandler({ options: { ...authOptions, secret: process.env.NEXTAUTH_SECRET }, req: { action: "csrf", method: "GET", headers: {}, cookies: {} } });
    const csrfCookie = csrf.cookies!.find((c) => c.name.endsWith("csrf-token"))!;
    const result = await authHandler({
      options: { ...authOptions, secret: process.env.NEXTAUTH_SECRET },
      req: {
        action: "callback",
        providerId: "credentials",
        method: "POST",
        headers: {},
        query: {},
        cookies: { [csrfCookie.name]: csrfCookie.value },
        body: { csrfToken: (csrf.body as { csrfToken: string }).csrfToken, email, password, json: "true" },
      },
    });
    const errorCode = result.redirect ? new URL(result.redirect).searchParams.get("error") : null;
    const sessionCookie = result.cookies?.find((c) => c.name.endsWith("session-token"));
    return { result, errorCode, sessionCookie };
  }

  /** Mirrors `getServerSession(authOptions)`: the call every page and API route makes. */
  async function sessionFor(sessionCookie: Cookie) {
    const response = await authHandler({
      options: { ...authOptions, providers: [], secret: process.env.NEXTAUTH_SECRET },
      req: { action: "session", method: "GET", headers: {}, cookies: { [sessionCookie.name]: sessionCookie.value } },
    });
    return Object.keys(response.body ?? {}).length ? response.body : null;
  }

  // --- the flow -----------------------------------------------------------

  it("register -> sign-in refused (no session issued) -> verify -> sign-in succeeds", async () => {
    const email = "new.owner@example.com";

    // 1. Register: the account exists but is unverified, and the verification email being sent changed nothing.
    const verificationEmail = await signUp(email);
    expect(verificationEmail.to).toEqual([email]);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();

    // 2. Correct credentials, unverified: refused with the deterministic code, and no session cookie of any kind.
    const blocked = await signIn(email, PASSWORD);
    expect(blocked.result.status).toBe(401);
    expect(blocked.errorCode).toBe("EMAIL_NOT_VERIFIED");
    expect(blocked.sessionCookie).toBeUndefined();
    expect(blocked.result.cookies?.some((c) => c.name.endsWith("session-token"))).toBeFalsy();

    // ...and it stays blocked on every retry — not a one-off.
    expect((await signIn(email, PASSWORD)).errorCode).toBe("EMAIL_NOT_VERIFIED");

    // A wrong password gets the ordinary credentials error, so the unverified state isn't disclosed to a guesser.
    const wrong = await signIn(email, "not-the-password");
    expect(wrong.errorCode).toBe("CredentialsSignin");

    // 3. Click the emailed link.
    const confirmed = await confirm(tokenFrom(verificationEmail));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ ok: true, email });
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).not.toBeNull();

    // 4. Only now does sign-in work: a session cookie is issued and resolves to this user.
    const allowed = await signIn(email, PASSWORD);
    expect(allowed.errorCode).toBeNull();
    expect(allowed.sessionCookie).toBeDefined();
    const session = (await sessionFor(allowed.sessionCookie!)) as { user: { id: string; email: string } } | null;
    expect(session?.user.email).toBe(email);
    expect(session?.user.id).toBe(user.id);
  });

  it("resend: sends a fresh link, the previous link stops working, the new one verifies", async () => {
    const email = "resend@example.com";
    const first = await signUp(email);

    expect((await resend(email)).status).toBe(200);
    await vi.waitFor(() => expect(mail.sent).toHaveLength(2));
    const second = mail.sent[1]!;
    expect(second.to).toEqual([email]);
    expect(tokenFrom(second)).not.toBe(tokenFrom(first));

    // Still unverified after a resend — sending mail verifies nothing.
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
    expect((await signIn(email, PASSWORD)).errorCode).toBe("EMAIL_NOT_VERIFIED");

    // Requesting a new link invalidated the old one.
    expect((await confirm(tokenFrom(first))).status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();

    expect((await confirm(tokenFrom(second))).status).toBe(200);
    expect((await signIn(email, PASSWORD)).sessionCookie).toBeDefined();
  });

  it("resend sends nothing for an unknown address or an already-verified account, and answers them identically", async () => {
    const email = "done@example.com";
    await confirm(tokenFrom(await signUp(email)));
    mail.sent.length = 0;

    const unknown = await resend("nobody@example.com");
    const verified = await resend(email);

    expect(unknown.status).toBe(200);
    expect(verified.status).toBe(200);
    expect(await unknown.json()).toEqual(await verified.json());
    // Give a (wrongly) fire-and-forget send a chance to land before asserting there is none.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mail.sent).toHaveLength(0);
  });

  it("a verification link is single-use: a second click is rejected and changes nothing", async () => {
    const email = "once@example.com";
    const token = tokenFrom(await signUp(email));

    expect((await confirm(token)).status).toBe(200);
    const verifiedAt = (await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt;

    const reuse = await confirm(token);
    expect(reuse.status).toBe(410);
    expect((await reuse.json()).error).toMatch(/already been used/i);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toEqual(verifiedAt);
  });

  it("an expired link is rejected and the account stays unverified and unable to sign in", async () => {
    const email = "late@example.com";
    const token = tokenFrom(await signUp(email));
    await prisma.emailVerificationToken.updateMany({
      where: { user: { email } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await confirm(token);
    expect(response.status).toBe(410);
    expect((await response.json()).error).toMatch(/expired/i);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
    expect((await signIn(email, PASSWORD)).errorCode).toBe("EMAIL_NOT_VERIFIED");
  });

  it("the link expires after the configured period (24h), not before", async () => {
    const email = "ttl@example.com";
    await signUp(email);
    const row = await prisma.emailVerificationToken.findFirstOrThrow({ where: { user: { email } } });

    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttl).toBeGreaterThan(db.EMAIL_VERIFICATION_TTL_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(db.EMAIL_VERIFICATION_TTL_MS + 5_000);
  });

  it("an invalid or garbage token is rejected and verifies nobody", async () => {
    const email = "bystander@example.com";
    await signUp(email);

    expect((await confirm("not-a-real-token")).status).toBe(404);
    expect((await confirm("x".repeat(500))).status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
    expect((await signIn(email, PASSWORD)).errorCode).toBe("EMAIL_NOT_VERIFIED");
  });

  it("only the raw token verifies: the stored hash is not a usable link", async () => {
    const email = "hashed@example.com";
    await signUp(email);
    const row = await prisma.emailVerificationToken.findFirstOrThrow({ where: { user: { email } } });

    expect((await confirm(row.tokenHash)).status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
  });

  it("one account's link never verifies another account", async () => {
    const tokenA = tokenFrom(await signUp("a@example.com"));
    await signUp("b@example.com");

    expect((await confirm(tokenA)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "a@example.com" } })).emailVerifiedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "b@example.com" } })).emailVerifiedAt).toBeNull();
    expect((await signIn("b@example.com", PASSWORD)).errorCode).toBe("EMAIL_NOT_VERIFIED");
  });

  it("a session that already exists stops working the moment its account is (or is found to be) unverified", async () => {
    // Stand-in for a token minted before the gate existed: a real, validly signed session cookie...
    const email = "legacy@example.com";
    await confirm(tokenFrom(await signUp(email)));
    const { sessionCookie } = await signIn(email, PASSWORD);
    expect(await sessionFor(sessionCookie!)).not.toBeNull();

    // ...for an account whose email is not verified. The very same cookie must no longer resolve to a user.
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: null } });

    expect(await sessionFor(sessionCookie!)).toBeNull();
  });

  it("an invitation-accepted account is verified on creation and can sign in straight away", async () => {
    // Accepting the emailed invitation link already proves control of the address (see `acceptInvitation`).
    const owner = await prisma.organization.create({ data: { name: "Inviter" } });
    const ownerUser = await prisma.user.create({
      data: { organizationId: owner.id, email: "owner@example.com", passwordHash: "x", role: "owner", emailVerifiedAt: new Date() },
    });
    const { token } = await db.createOrResendInvitation(prisma, {
      organizationId: owner.id,
      invitedByUserId: ownerUser.id,
      email: "teammate@example.com",
    });
    const bcrypt = (await import("bcryptjs")).default;
    await db.acceptInvitation(prisma, { token, name: "Teammate", passwordHash: await bcrypt.hash(PASSWORD, 4) });

    const { errorCode, sessionCookie } = await signIn("teammate@example.com", PASSWORD);
    expect(errorCode).toBeNull();
    expect(sessionCookie).toBeDefined();
  });
});
