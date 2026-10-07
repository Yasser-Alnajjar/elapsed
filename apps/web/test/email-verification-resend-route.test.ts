/**
 * `POST /api/email-verification/resend`: the public resend endpoint an
 * unverified user (who can't sign in, so has no session) uses to get a
 * fresh verification link. Pattern A, fully mocked (`@sla/db`,
 * `@/lib/transactional-email`) — the real-database behavior (old link
 * invalidated, new one works) is covered in `email-verification-flow.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findUnique: vi.fn(), createEmailVerificationToken: vi.fn() }));
const transactionalEmail = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn(async () => {}) }));

vi.mock("@sla/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sla/db")>();
  return {
    ...actual,
    getPrismaClient: vi.fn(() => ({ user: { findUnique: db.findUnique } })),
    createEmailVerificationToken: db.createEmailVerificationToken,
  };
});
vi.mock("@/lib/transactional-email", () => ({ sendTransactionalEmail: transactionalEmail.sendTransactionalEmail }));

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

beforeEach(async () => {
  vi.resetModules();
  db.findUnique.mockReset();
  db.createEmailVerificationToken.mockReset();
  db.createEmailVerificationToken.mockResolvedValue({ token: "fresh-token" });
  transactionalEmail.sendTransactionalEmail.mockReset();
  transactionalEmail.sendTransactionalEmail.mockResolvedValue(undefined);
  process.env.NEXTAUTH_URL = "https://sla.example.com";
  (await import("../src/lib/rate-limit"))._resetRateLimitState();
});

afterEach(() => {
  process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
});

function postRequest(body: unknown) {
  return new Request("http://localhost/api/email-verification/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function flushMicrotasks() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("POST /api/email-verification/resend", () => {
  it("returns 400 for a missing or malformed email, without touching the database", async () => {
    const { POST } = await import("../src/app/api/email-verification/resend/route");

    expect((await POST(postRequest({}))).status).toBe(400);
    expect((await POST(postRequest({ email: "not-an-email" }))).status).toBe(400);
    expect(db.findUnique).not.toHaveBeenCalled();
  });

  it("issues a new token and emails a verification link to an unverified account", async () => {
    db.findUnique.mockResolvedValue({ id: "u1", email: "new@example.com", emailVerifiedAt: null });
    const { POST } = await import("../src/app/api/email-verification/resend/route");

    const response = await POST(postRequest({ email: "new@example.com" }));
    await flushMicrotasks();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.createEmailVerificationToken).toHaveBeenCalledWith(expect.anything(), "u1");
    expect(transactionalEmail.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const request = (transactionalEmail.sendTransactionalEmail.mock.calls[0] as unknown as [{ to: string[]; template: string; data: { verifyUrl: string } }])[0];
    expect(request.to).toEqual(["new@example.com"]);
    expect(request.template).toBe("email-verification");
    expect(request.data.verifyUrl).toBe("https://sla.example.com/verify-email?token=fresh-token");
  });

  it("normalizes the address (case/whitespace) before looking it up", async () => {
    db.findUnique.mockResolvedValue(null);
    const { POST } = await import("../src/app/api/email-verification/resend/route");

    await POST(postRequest({ email: "  New@Example.COM " }));

    expect(db.findUnique).toHaveBeenCalledWith({ where: { email: "new@example.com" } });
  });

  it("answers an unknown address with the same { ok: true } and sends nothing (no enumeration)", async () => {
    db.findUnique.mockResolvedValue(null);
    const { POST } = await import("../src/app/api/email-verification/resend/route");

    const response = await POST(postRequest({ email: "nobody@example.com" }));
    await flushMicrotasks();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.createEmailVerificationToken).not.toHaveBeenCalled();
    expect(transactionalEmail.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("answers an already-verified account with the same { ok: true } and sends nothing", async () => {
    db.findUnique.mockResolvedValue({ id: "u1", email: "ok@example.com", emailVerifiedAt: new Date() });
    const { POST } = await import("../src/app/api/email-verification/resend/route");

    const response = await POST(postRequest({ email: "ok@example.com" }));
    await flushMicrotasks();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.createEmailVerificationToken).not.toHaveBeenCalled();
    expect(transactionalEmail.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("still returns { ok: true } when the email fails to send (logged, not surfaced)", async () => {
    db.findUnique.mockResolvedValue({ id: "u1", email: "new@example.com", emailVerifiedAt: null });
    transactionalEmail.sendTransactionalEmail.mockRejectedValue(new Error("smtp down"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../src/app/api/email-verification/resend/route");

    const response = await POST(postRequest({ email: "new@example.com" }));
    await flushMicrotasks();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("limits each address to 3 resends per window — the same for a real and an unknown address — and 429s with Retry-After", async () => {
    db.findUnique.mockResolvedValue(null);
    const { POST } = await import("../src/app/api/email-verification/resend/route");

    for (let i = 0; i < 3; i += 1) {
      expect((await POST(postRequest({ email: "spam@example.com" }))).status).toBe(200);
    }
    const blocked = await POST(postRequest({ email: "spam@example.com" }));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toMatch(/too many attempts/i);
    // A different address has its own budget.
    expect((await POST(postRequest({ email: "other@example.com" }))).status).toBe(200);
  });
});
