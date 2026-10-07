/**
 * `POST /api/me/email` (request an email change) and
 * `POST /api/me/resend-verification` (roadmap 5.6): authenticated,
 * session-gated like every other `/api/me/**` route. Pattern A, fully
 * mocked (`next-auth`, `@/lib/auth`, `@sla/db`, `bcryptjs`,
 * `@/lib/transactional-email`).
 */
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createEmailChangeToken: vi.fn(),
  createEmailVerificationToken: vi.fn(),
}));
const bcrypt = vi.hoisted(() => ({ compare: vi.fn() }));
const email = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sla/db")>();
  return {
    ...actual,
    getPrismaClient: vi.fn(() => ({ user: { findUnique: db.findUnique } })),
    createEmailChangeToken: db.createEmailChangeToken,
    createEmailVerificationToken: db.createEmailVerificationToken,
  };
});
vi.mock("bcryptjs", () => ({ default: { compare: bcrypt.compare } }));
vi.mock("@/lib/transactional-email", () => ({ sendTransactionalEmail: email.sendTransactionalEmail }));

function sessionFor(userId = "user-1"): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: {
      id: userId,
      organizationId: "org-1",
      email: "a@x.com",
      emailVerifiedAt: new Date(),
      name: null,
      image: null,
      role: "owner",
      createdAt: new Date(),
    },
  };
}

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

beforeEach(() => {
  vi.resetModules();
  auth.session = null;
  db.findUnique.mockReset();
  db.createEmailChangeToken.mockReset();
  db.createEmailVerificationToken.mockReset();
  bcrypt.compare.mockReset();
  email.sendTransactionalEmail.mockReset();
  email.sendTransactionalEmail.mockResolvedValue(undefined);
  process.env.NEXTAUTH_URL = "https://sla.example.com";
});

afterEach(() => {
  process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
});

function postRequest(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/me/email", () => {
  it("returns 401 when signed out", async () => {
    const { POST } = await import("../src/app/api/me/email/route");
    const response = await POST(postRequest("http://localhost/api/me/email", { newEmail: "b@x.com", currentPassword: "x" }));
    expect(response.status).toBe(401);
  });

  it("returns 400 for an invalid new email", async () => {
    auth.session = sessionFor();
    const { POST } = await import("../src/app/api/me/email/route");
    const response = await POST(
      postRequest("http://localhost/api/me/email", { newEmail: "not-an-email", currentPassword: "x" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for an incorrect current password, without creating a token", async () => {
    auth.session = sessionFor();
    db.findUnique.mockResolvedValue({ id: "user-1", email: "a@x.com", passwordHash: "hash" });
    bcrypt.compare.mockResolvedValue(false);
    const { POST } = await import("../src/app/api/me/email/route");
    const response = await POST(
      postRequest("http://localhost/api/me/email", { newEmail: "b@x.com", currentPassword: "wrong" }),
    );
    expect(response.status).toBe(400);
    expect(db.createEmailChangeToken).not.toHaveBeenCalled();
  });

  it("returns 400 when newEmail is already the current email", async () => {
    auth.session = sessionFor();
    db.findUnique.mockResolvedValue({ id: "user-1", email: "a@x.com", passwordHash: "hash" });
    bcrypt.compare.mockResolvedValue(true);
    const { POST } = await import("../src/app/api/me/email/route");
    const response = await POST(
      postRequest("http://localhost/api/me/email", { newEmail: "a@x.com", currentPassword: "correct" }),
    );
    expect(response.status).toBe(400);
    expect(db.createEmailChangeToken).not.toHaveBeenCalled();
  });

  it("returns 409 when newEmail already has an account", async () => {
    auth.session = sessionFor();
    db.findUnique.mockResolvedValue({ id: "user-1", email: "a@x.com", passwordHash: "hash" });
    bcrypt.compare.mockResolvedValue(true);
    const { EmailAlreadyRegisteredError } = await import("@sla/db");
    db.createEmailChangeToken.mockRejectedValue(new EmailAlreadyRegisteredError("b@x.com"));
    const { POST } = await import("../src/app/api/me/email/route");
    const response = await POST(
      postRequest("http://localhost/api/me/email", { newEmail: "b@x.com", currentPassword: "correct" }),
    );
    expect(response.status).toBe(409);
  });

  it("sends a confirmation email to the new address and returns ok:true", async () => {
    auth.session = sessionFor();
    db.findUnique.mockResolvedValue({ id: "user-1", email: "a@x.com", passwordHash: "hash" });
    bcrypt.compare.mockResolvedValue(true);
    db.createEmailChangeToken.mockResolvedValue({ token: "raw-token" });
    const { POST } = await import("../src/app/api/me/email/route");
    const response = await POST(
      postRequest("http://localhost/api/me/email", { newEmail: "b@x.com", currentPassword: "correct" }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(email.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const sentRequest = email.sendTransactionalEmail.mock.calls[0]![0];
    expect(sentRequest.to).toEqual(["b@x.com"]);
    expect(sentRequest.template).toBe("email-change-verification");
    expect(sentRequest.data.confirmUrl).toContain("raw-token");
  });

  it("returns 502 when the confirmation email fails to send", async () => {
    auth.session = sessionFor();
    db.findUnique.mockResolvedValue({ id: "user-1", email: "a@x.com", passwordHash: "hash" });
    bcrypt.compare.mockResolvedValue(true);
    db.createEmailChangeToken.mockResolvedValue({ token: "raw-token" });
    email.sendTransactionalEmail.mockRejectedValue(new Error("smtp down"));
    const { POST } = await import("../src/app/api/me/email/route");
    const response = await POST(
      postRequest("http://localhost/api/me/email", { newEmail: "b@x.com", currentPassword: "correct" }),
    );
    expect(response.status).toBe(502);
  });
});

describe("POST /api/me/resend-verification", () => {
  it("returns 401 when signed out", async () => {
    const { POST } = await import("../src/app/api/me/resend-verification/route");
    const response = await POST();
    expect(response.status).toBe(401);
  });

  it("is a no-op (still ok:true) when already verified, without issuing a token", async () => {
    auth.session = sessionFor();
    db.findUnique.mockResolvedValue({ id: "user-1", email: "a@x.com", emailVerifiedAt: new Date() });
    const { POST } = await import("../src/app/api/me/resend-verification/route");
    const response = await POST();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(db.createEmailVerificationToken).not.toHaveBeenCalled();
  });

  it("issues a token and sends the verification email when unverified", async () => {
    auth.session = sessionFor();
    db.findUnique.mockResolvedValue({ id: "user-1", email: "a@x.com", emailVerifiedAt: null });
    db.createEmailVerificationToken.mockResolvedValue({ token: "raw-token" });
    const { POST } = await import("../src/app/api/me/resend-verification/route");
    const response = await POST();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(email.sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });
});
