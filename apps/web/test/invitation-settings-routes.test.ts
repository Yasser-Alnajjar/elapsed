/**
 * `GET/POST /api/settings/invitations` and `DELETE
 * /api/settings/invitations/[id]` (roadmap 5.2): session-gated invitation
 * management, same pattern as every other settings route (Pattern A,
 * fully mocked — `@sla/db`'s domain functions and `@sla/email`'s
 * `sendTransactionalEmail`/`sendEmail`, `next-auth`, `@/lib/auth`). The
 * error *classes* are kept real via `importActual` so the routes' own
 * `instanceof` checks exercise real behavior, not a mock's identity.
 */
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({
  createOrResendInvitation: vi.fn(),
  listPendingInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
}));
const email = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));
const entitlements = vi.hoisted(() => ({ gateCreation: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sla/db")>();
  return {
    ...actual,
    getPrismaClient: vi.fn(() => ({})),
    createOrResendInvitation: db.createOrResendInvitation,
    listPendingInvitations: db.listPendingInvitations,
    revokeInvitation: db.revokeInvitation,
  };
});
vi.mock("@/lib/entitlements", () => ({ gateCreation: entitlements.gateCreation }));
vi.mock("@/lib/transactional-email", () => ({ sendTransactionalEmail: email.sendTransactionalEmail }));

function sessionFor(organizationId: string, userId = "user-1", role: "owner" | "member" = "owner"): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: userId, organizationId, email: "owner@tenant.test", emailVerifiedAt: new Date(), name: null, image: null, role, createdAt: new Date() },
  };
}

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

beforeEach(() => {
  vi.resetModules();
  db.createOrResendInvitation.mockReset();
  db.listPendingInvitations.mockReset();
  db.revokeInvitation.mockReset();
  email.sendTransactionalEmail.mockReset();
  entitlements.gateCreation.mockReset();
  entitlements.gateCreation.mockResolvedValue({ proceed: true, warning: null });
  auth.session = null;
  process.env.NEXTAUTH_URL = "https://sla.example.com";
});

afterEach(() => {
  process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
});

describe("GET /api/settings/invitations", () => {
  it("rejects a signed-out request with 401", async () => {
    const { GET } = await import("../src/app/api/settings/invitations/route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(db.listPendingInvitations).not.toHaveBeenCalled();
  });

  it("returns the caller's own organization's pending invitations", async () => {
    auth.session = sessionFor("org-a");
    db.listPendingInvitations.mockResolvedValue([
      {
        id: "inv-1",
        email: "a@x.com",
        expiresAt: new Date("2026-10-01T00:00:00Z"),
        createdAt: new Date("2026-09-24T00:00:00Z"),
      },
    ]);

    const { GET } = await import("../src/app/api/settings/invitations/route");
    const response = await GET();
    const body = await response.json();

    expect(db.listPendingInvitations).toHaveBeenCalledWith(expect.anything(), "org-a");
    expect(body.invitations).toEqual([
      { id: "inv-1", email: "a@x.com", expiresAt: "2026-10-01T00:00:00.000Z", createdAt: "2026-09-24T00:00:00.000Z" },
    ]);
  });
});

describe("POST /api/settings/invitations", () => {
  function postRequest(body: unknown) {
    return new Request("http://localhost/api/settings/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects a signed-out request with 401 and never creates an invitation", async () => {
    const { POST } = await import("../src/app/api/settings/invitations/route");
    const response = await POST(postRequest({ email: "a@x.com" }));
    expect(response.status).toBe(401);
    expect(db.createOrResendInvitation).not.toHaveBeenCalled();
  });

  it("rejects a member's invite request with 403 and never creates an invitation", async () => {
    auth.session = sessionFor("org-a", "user-1", "member");
    const { POST } = await import("../src/app/api/settings/invitations/route");
    const response = await POST(postRequest({ email: "a@x.com" }));
    expect(response.status).toBe(403);
    expect(db.createOrResendInvitation).not.toHaveBeenCalled();
  });

  it("rejects an invalid email with 400", async () => {
    auth.session = sessionFor("org-a");
    const { POST } = await import("../src/app/api/settings/invitations/route");
    const response = await POST(postRequest({ email: "not-an-email" }));
    expect(response.status).toBe(400);
    expect(db.createOrResendInvitation).not.toHaveBeenCalled();
  });

  it("normalizes the email (trim + lowercase) before calling into the domain layer", async () => {
    auth.session = sessionFor("org-a", "user-1");
    db.createOrResendInvitation.mockResolvedValue({
      invitation: { id: "inv-1" },
      token: "raw-token",
      organizationName: "Acme",
      resent: false,
    });
    email.sendTransactionalEmail.mockResolvedValue(undefined);

    const { POST } = await import("../src/app/api/settings/invitations/route");
    await POST(postRequest({ email: "  Alice@Example.com  " }));

    expect(db.createOrResendInvitation).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-a",
      invitedByUserId: "user-1",
      email: "alice@example.com",
    });
  });

  it("returns 409 when the email is already registered, without sending any email", async () => {
    auth.session = sessionFor("org-a");
    const { EmailAlreadyRegisteredError } = await import("@sla/db");
    db.createOrResendInvitation.mockRejectedValue(new EmailAlreadyRegisteredError("a@x.com"));

    const { POST } = await import("../src/app/api/settings/invitations/route");
    const response = await POST(postRequest({ email: "a@x.com" }));

    expect(response.status).toBe(409);
    expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("sends the invitation email and returns ok:true, resent:false on success", async () => {
    auth.session = sessionFor("org-a");
    db.createOrResendInvitation.mockResolvedValue({
      invitation: { id: "inv-1" },
      token: "raw-token",
      organizationName: "Acme",
      resent: false,
    });
    email.sendTransactionalEmail.mockResolvedValue(undefined);

    const { POST } = await import("../src/app/api/settings/invitations/route");
    const response = await POST(postRequest({ email: "a@x.com" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, resent: false });
    expect(email.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const [request] = email.sendTransactionalEmail.mock.calls[0]!;
    expect(request.to).toEqual(["a@x.com"]);
    expect(request.template).toBe("invitation");
    expect(request.data.acceptUrl).toContain("raw-token");
    expect(request.data.organizationName).toBe("Acme");
  });

  it("returns 502 (but keeps the created invitation) when the email fails to send", async () => {
    auth.session = sessionFor("org-a");
    db.createOrResendInvitation.mockResolvedValue({
      invitation: { id: "inv-1" },
      token: "raw-token",
      organizationName: "Acme",
      resent: false,
    });
    email.sendTransactionalEmail.mockRejectedValue(new Error("smtp down"));

    const { POST } = await import("../src/app/api/settings/invitations/route");
    const response = await POST(postRequest({ email: "a@x.com" }));

    expect(response.status).toBe(502);
    expect(db.createOrResendInvitation).toHaveBeenCalledTimes(1); // not retried within this call
  });
});

describe("DELETE /api/settings/invitations/[id]", () => {
  function deleteRequest() {
    return new Request("http://localhost/api/settings/invitations/inv-1", { method: "DELETE" });
  }

  it("rejects a signed-out request with 401", async () => {
    const { DELETE } = await import("../src/app/api/settings/invitations/[id]/route");
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: "inv-1" }) });
    expect(response.status).toBe(401);
    expect(db.revokeInvitation).not.toHaveBeenCalled();
  });

  it("rejects a member's revoke request with 403", async () => {
    auth.session = sessionFor("org-a", "user-1", "member");
    const { DELETE } = await import("../src/app/api/settings/invitations/[id]/route");
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: "inv-1" }) });
    expect(response.status).toBe(403);
    expect(db.revokeInvitation).not.toHaveBeenCalled();
  });

  it("revokes scoped to the caller's own organization", async () => {
    auth.session = sessionFor("org-a");
    db.revokeInvitation.mockResolvedValue(undefined);

    const { DELETE } = await import("../src/app/api/settings/invitations/[id]/route");
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: "inv-1" }) });

    expect(response.status).toBe(200);
    expect(db.revokeInvitation).toHaveBeenCalledWith(expect.anything(), { organizationId: "org-a", invitationId: "inv-1" });
  });
});

describe("POST /api/settings/invitations: plan entitlements (N6.3, N6.4)", () => {
  const post = async (email = "new@x.com") => {
    const { POST } = await import("../src/app/api/settings/invitations/route");
    return POST(new Request("http://localhost/api/settings/invitations", { method: "POST", body: JSON.stringify({ email }) }));
  };

  it("checks the caller's own organization for the seat resource", async () => {
    auth.session = sessionFor("org-a");
    db.createOrResendInvitation.mockResolvedValue({ invitation: {}, token: "t", organizationName: "A", resent: false });
    await post();
    expect(entitlements.gateCreation).toHaveBeenCalledWith("org-a", "seats");
  });

  it("still sends the invitation when over the seat limit, and returns the warning with an upgrade path", async () => {
    auth.session = sessionFor("org-a");
    const warning = { resource: "seats", level: "reached", message: "You have reached your plan's limit: 5 of 5 seats.", upgradeUrl: "mailto:help@elapsed.test" };
    entitlements.gateCreation.mockResolvedValue({ proceed: true, warning });
    db.createOrResendInvitation.mockResolvedValue({ invitation: {}, token: "t", organizationName: "A", resent: false });

    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, entitlementWarning: warning });
    expect(db.createOrResendInvitation).toHaveBeenCalledTimes(1);
    expect(email.sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("returns 402 and creates nothing once the trial has ended", async () => {
    auth.session = sessionFor("org-a");
    const { NextResponse } = await import("next/server");
    entitlements.gateCreation.mockResolvedValue({
      proceed: false,
      response: NextResponse.json({ error: "Your trial has ended.", code: "trial_expired", upgradeUrl: "mailto:help@elapsed.test" }, { status: 402 }),
    });

    const response = await post();
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "trial_expired", upgradeUrl: "mailto:help@elapsed.test" });
    expect(db.createOrResendInvitation).not.toHaveBeenCalled();
    expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
