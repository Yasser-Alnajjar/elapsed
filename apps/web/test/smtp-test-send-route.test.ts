/**
 * `POST /api/settings/email/test-send`: the "Send test email" button. It
 * sends through the organization's own SMTP, so it must go through the same
 * Elapsed template path as every other email. Pattern A, fully mocked
 * (`next-auth`, `@/lib/auth`, `@sla/db`, `@/lib/email-settings`, `@sla/email`'s
 * `sendEmail`); the template request is rendered by the real layout.
 */
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@sla/db")>()), getPrismaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/email-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email-settings")>()),
  resolveTestPassword: vi.fn(async (_p: unknown, _o: string, input: { password?: string }) => ({ password: input.password ?? "saved" })),
}));
vi.mock("@sla/email", async (importOriginal) => ({ ...(await importOriginal<typeof import("@sla/email")>()), sendEmail: mail.sendEmail }));

const session = (overrides: Partial<Session["user"]> = {}): Session => ({
  expires: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: "u1", organizationId: "org-1", email: "owner@acme.test", emailVerifiedAt: new Date(), name: null, image: null, role: "owner", createdAt: new Date(), ...overrides },
});

const body = { host: "smtp.acme.test", port: 587, security: "starttls", username: "u", password: "p", fromEmail: "alerts@acme.test", fromName: "Acme Support" };
const post = (payload: unknown) =>
  new Request("http://localhost/api/settings/email/test-send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

beforeEach(() => {
  vi.resetModules();
  auth.session = session();
  mail.sendEmail.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/settings/email/test-send", () => {
  it("sends the smtp-test template, as a template request, through the organization's SMTP with the public-destination guard", async () => {
    const { POST } = await import("../src/app/api/settings/email/test-send/route");
    const response = await POST(post(body));

    expect(response.status).toBe(200);
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    const input = mail.sendEmail.mock.calls[0]![0];
    expect(input).toMatchObject({
      template: "smtp-test",
      to: ["owner@acme.test"],
      data: { senderName: "Acme Support" },
      smtp: expect.objectContaining({ host: "smtp.acme.test", from: "alerts@acme.test", fromName: "Acme Support" }),
      delivery: { publicDestinationOnly: true },
    });
    expect(input).not.toHaveProperty("html");
    expect(input).not.toHaveProperty("subject");
    expect(input).not.toHaveProperty("text");
  });

  it("renders as the Elapsed test email, in the Elapsed shell", async () => {
    const { renderEmail } = await import("@sla/email");
    const { POST } = await import("../src/app/api/settings/email/test-send/route");
    await POST(post(body));

    const { template, data } = mail.sendEmail.mock.calls[0]![0];
    const email = renderEmail({ template, data }, { appUrl: null });
    expect(email.subject).toBe("Elapsed — Test Email");
    expect(email.html).toContain('data-elapsed-email="shell"');
    expect(email.text).toContain("SMTP configuration for Elapsed is working correctly");
  });

  it("requires a signed-in owner and sends nothing otherwise", async () => {
    const { POST } = await import("../src/app/api/settings/email/test-send/route");
    auth.session = null;
    expect((await POST(post(body))).status).toBe(401);
    auth.session = session({ role: "member" });
    expect((await POST(post(body))).status).toBe(403);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("reports a delivery failure as 502 without leaking the password", async () => {
    mail.sendEmail.mockRejectedValue(new Error("auth failed for p"));
    const { POST } = await import("../src/app/api/settings/email/test-send/route");
    const response = await POST(post(body));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('"p"');
  });
});
