/**
 * `POST /api/sign-up`: account creation, plus (roadmap 5.6) issuing the
 * signup email-verification token/email. Pattern A, fully mocked
 * (`@sla/db`, `bcryptjs`, `@/lib/transactional-email`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  createEmailVerificationToken: vi.fn(),
}));
const bcrypt = vi.hoisted(() => ({ hash: vi.fn(async () => "hashed-password") }));
const transactionalEmail = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn(async () => {}) }));

vi.mock("@sla/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sla/db")>();
  return {
    ...actual,
    getPrismaClient: vi.fn(() => ({
      user: { findUnique: db.findUnique },
      organization: { create: db.create },
    })),
    createEmailVerificationToken: db.createEmailVerificationToken,
  };
});
vi.mock("bcryptjs", () => ({ default: { hash: bcrypt.hash } }));
vi.mock("@/lib/transactional-email", () => ({ sendTransactionalEmail: transactionalEmail.sendTransactionalEmail }));

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

beforeEach(() => {
  vi.resetModules();
  db.findUnique.mockReset();
  db.create.mockReset();
  db.createEmailVerificationToken.mockReset();
  db.createEmailVerificationToken.mockResolvedValue({ token: "raw-token" });
  bcrypt.hash.mockClear();
  transactionalEmail.sendTransactionalEmail.mockReset();
  transactionalEmail.sendTransactionalEmail.mockResolvedValue(undefined);
  process.env.NEXTAUTH_URL = "https://sla.example.com";
});

afterEach(() => {
  process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
});

function postRequest(body: unknown) {
  return new Request("http://localhost/api/sign-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const VALID_INPUT = { organizationName: "Acme", email: "a@x.com", password: "password123" };

describe("POST /api/sign-up", () => {
  it("returns 400 for invalid input", async () => {
    const { POST } = await import("../src/app/api/sign-up/route");
    const response = await POST(postRequest({ organizationName: "", email: "not-an-email", password: "short" }));
    expect(response.status).toBe(400);
  });

  it("returns 409 when the email already has an account, without creating anything", async () => {
    db.findUnique.mockResolvedValue({ id: "existing" });
    const { POST } = await import("../src/app/api/sign-up/route");
    const response = await POST(postRequest(VALID_INPUT));
    expect(response.status).toBe(409);
    expect(db.create).not.toHaveBeenCalled();
  });

  it("creates the organization/owner and returns ok:true", async () => {
    db.findUnique.mockResolvedValue(null);
    db.create.mockResolvedValue({ id: "org1", users: [{ id: "user1", email: VALID_INPUT.email }] });
    const { POST } = await import("../src/app/api/sign-up/route");
    const response = await POST(postRequest(VALID_INPUT));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(db.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Acme",
          users: {
            create: {
              email: VALID_INPUT.email,
              passwordHash: "hashed-password",
              role: "owner",
              name: null,
              acceptedTermsAt: null,
            },
          },
        }),
        include: { users: true },
      }),
    );
  });

  it("issues a verification token and sends the verification email for the new user", async () => {
    db.findUnique.mockResolvedValue(null);
    db.create.mockResolvedValue({ id: "org1", users: [{ id: "user1", email: VALID_INPUT.email }] });
    const { POST } = await import("../src/app/api/sign-up/route");
    await POST(postRequest(VALID_INPUT));
    await flushMicrotasks();

    expect(db.createEmailVerificationToken).toHaveBeenCalledWith(expect.anything(), "user1");
    expect(transactionalEmail.sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("still returns ok:true (sign-up succeeds) when the verification email fails to send", async () => {
    db.findUnique.mockResolvedValue(null);
    db.create.mockResolvedValue({ id: "org1", users: [{ id: "user1", email: VALID_INPUT.email }] });
    transactionalEmail.sendTransactionalEmail.mockRejectedValue(new Error("smtp down"));
    const { POST } = await import("../src/app/api/sign-up/route");
    const response = await POST(postRequest(VALID_INPUT));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    await flushMicrotasks();
  });
});
