import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConfig } from "../src/types";

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ verify: vi.fn(), sendMail: sendMailMock }));

vi.mock("nodemailer", () => ({
  default: { createTransport: (...args: unknown[]) => createTransportMock(...args) },
}));

const { sendEmail } = await import("../src/send");
const { UnknownEmailTemplateError } = await import("../src/render");

const smtp: EmailConfig = { host: "smtp.example.com", port: 587, security: "starttls", user: "u", password: "p", from: "no-reply@example.com" };
const RESET = { resetUrl: "https://app.example.com/reset-password?token=t", ttlMinutes: 60 };

let originalUrl: string | undefined;
beforeEach(() => {
  originalUrl = process.env.NEXTAUTH_URL;
  createTransportMock.mockClear();
  sendMailMock.mockReset().mockResolvedValue({ messageId: "1" });
});
afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalUrl;
});

function sent() {
  return sendMailMock.mock.calls[0]![0] as { from: string; to: string[]; subject: string; text: string; html: string; attachments: { filename: string }[] };
}

describe("sendEmail", () => {
  it("renders the template inside the Elapsed shell and hands the finished message to SMTP", async () => {
    await sendEmail({ smtp, to: ["a@example.com"], template: "password-reset", data: RESET, appUrl: "https://app.example.com" });

    const message = sent();
    expect(message.from).toBe("no-reply@example.com");
    expect(message.to).toEqual(["a@example.com"]);
    expect(message.subject).toBe("Reset your Elapsed password");
    expect(message.html).toContain('data-elapsed-email="shell"');
    expect(message.html).toContain("https://app.example.com/reset-password?token=t");
    expect(message.text).toContain("Reset your password: https://app.example.com/reset-password?token=t");
    expect(message.text).toContain("© ");
  });

  it("ignores any subject, text or html a caller smuggles in: the template output is all that is sent", async () => {
    const smuggled = { smtp, to: ["a@example.com"], template: "password-reset", data: RESET, appUrl: null, subject: "Hijacked", text: "raw text", html: "<p>raw html</p>" };
    await sendEmail(smuggled as never);

    const message = sent();
    expect(message.subject).toBe("Reset your Elapsed password");
    expect(message.html).not.toContain("raw html");
    expect(message.text).not.toContain("raw text");
    expect(message.html).toContain('data-elapsed-email="shell"');
  });

  it("fails closed on an unregistered template, before any connection is made", async () => {
    await expect(sendEmail({ smtp, to: ["a@example.com"], template: "made-up", data: {} } as never)).rejects.toBeInstanceOf(UnknownEmailTemplateError);
    await expect(sendEmail({ smtp, to: ["a@example.com"], template: "toString", data: {} } as never)).rejects.toBeInstanceOf(UnknownEmailTemplateError);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("attaches a caller's file without it changing the rendered message", async () => {
    await sendEmail({
      smtp,
      to: ["a@example.com"],
      template: "password-reset",
      data: RESET,
      appUrl: null,
      attachments: [{ filename: "report.csv", content: "a,b", contentType: "text/csv" }],
    });
    expect(sent().attachments.map((file) => file.filename)).toEqual(["report.csv", "elapsed-logo.png"]);
  });

  it("reads the footer URL from NEXTAUTH_URL by default, and an explicit null means none", async () => {
    process.env.NEXTAUTH_URL = "https://sla.example.org/some/path";
    await sendEmail({ smtp, to: ["a@example.com"], template: "password-reset", data: RESET });
    expect(sent().html).toContain('href="https://sla.example.org"');

    sendMailMock.mockClear();
    await sendEmail({ smtp, to: ["a@example.com"], template: "password-reset", data: RESET, appUrl: null });
    expect(sent().html).not.toContain("Open Elapsed");
  });

  it("treats a malformed deployment URL as not configured rather than emitting a broken link", async () => {
    await sendEmail({ smtp, to: ["a@example.com"], template: "password-reset", data: RESET, appUrl: "javascript:alert(1)" });
    expect(sent().html).not.toContain("javascript:");
    expect(sent().html).not.toContain("Open Elapsed");
  });

  it("passes the destination guard option through to the transport", async () => {
    await expect(
      sendEmail({ smtp: { ...smtp, host: "127.0.0.1" }, to: ["a@example.com"], template: "password-reset", data: RESET, delivery: { publicDestinationOnly: true } }),
    ).rejects.toMatchObject({ name: "SmtpDestinationNotAllowedError" });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("propagates a delivery failure", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("connection refused"));
    await expect(sendEmail({ smtp, to: ["a@example.com"], template: "password-reset", data: RESET })).rejects.toThrow("connection refused");
  });
});
