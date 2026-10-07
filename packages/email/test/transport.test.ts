import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderEmail } from "../src/render";
import { UnrenderedEmailError } from "../src/rendered";
import type { EmailConfig } from "../src/types";

const verifyMock = vi.fn();
const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ verify: verifyMock, sendMail: sendMailMock }));

vi.mock("nodemailer", () => ({
  default: { createTransport: (...args: unknown[]) => createTransportMock(...args) },
}));

const { deliver, verifyEmailConfig } = await import("../src/transport");

const rendered = renderEmail({ template: "password-reset", data: { resetUrl: "https://app.example.com/reset-password?token=t", ttlMinutes: 60 } }, { appUrl: null });

const baseConfig: EmailConfig = {
  host: "smtp.example.com",
  port: 587,
  security: "starttls",
  user: "sla@example.com",
  password: "hunter2",
  from: "sla@example.com",
  fromName: null,
};

beforeEach(() => {
  createTransportMock.mockClear();
  verifyMock.mockReset().mockResolvedValue(true);
  sendMailMock.mockReset().mockResolvedValue({ messageId: "1" });
});

describe("createTransporter security mapping (via verifyEmailConfig)", () => {
  it("maps starttls to secure:false without ignoring TLS", async () => {
    await verifyEmailConfig(baseConfig);
    const options = createTransportMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.secure).toBe(false);
    expect(options.ignoreTLS).toBeUndefined();
    expect(options.port).toBe(587);
  });

  it("maps ssl_tls to secure:true", async () => {
    await verifyEmailConfig({ ...baseConfig, port: 465, security: "ssl_tls" });
    const options = createTransportMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.secure).toBe(true);
    expect(options.port).toBe(465);
  });

  it("maps none to secure:false and ignoreTLS:true", async () => {
    await verifyEmailConfig({ ...baseConfig, security: "none" });
    const options = createTransportMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.secure).toBe(false);
    expect(options.ignoreTLS).toBe(true);
  });

  it("never infers security from the port", async () => {
    // Port 465 with STARTTLS is unusual but must not be silently upgraded to implicit TLS.
    await verifyEmailConfig({ ...baseConfig, port: 465, security: "starttls" });
    const options = createTransportMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.secure).toBe(false);
  });

  it("sets connection/greeting/socket timeouts so a dead host fails fast", async () => {
    await verifyEmailConfig(baseConfig);
    const options = createTransportMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.connectionTimeout).toBeGreaterThan(0);
    expect(options.greetingTimeout).toBeGreaterThan(0);
    expect(options.socketTimeout).toBeGreaterThan(0);
  });

  it("passes the username/password as SMTP auth", async () => {
    await verifyEmailConfig(baseConfig);
    const options = createTransportMock.mock.calls[0][0] as { auth: { user: string; pass: string } };
    expect(options.auth).toEqual({ user: "sla@example.com", pass: "hunter2" });
  });
});

describe("verifyEmailConfig", () => {
  it("resolves when the transporter authenticates successfully", async () => {
    await expect(verifyEmailConfig(baseConfig)).resolves.toBeUndefined();
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("propagates an authentication failure", async () => {
    verifyMock.mockRejectedValueOnce(new Error("Invalid login: 535 authentication failed"));
    await expect(verifyEmailConfig(baseConfig)).rejects.toThrow("Invalid login");
  });

  it("propagates a connection failure", async () => {
    verifyMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:587"));
    await expect(verifyEmailConfig(baseConfig)).rejects.toThrow("ECONNREFUSED");
  });
});

describe("deliver", () => {
  it("sends the rendered subject, text and html from the configured address", async () => {
    await deliver(baseConfig, { to: ["a@example.com"], email: rendered });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "sla@example.com", to: ["a@example.com"], subject: rendered.subject, text: rendered.text, html: rendered.html }),
    );
  });

  it("formats a quoted display name into the From header when fromName is set", async () => {
    await deliver({ ...baseConfig, fromName: "SLA Alerts" }, { to: ["a@example.com"], email: rendered });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ from: '"SLA Alerts" <sla@example.com>' }));
  });

  it("sends the logo as an inline, cid-referenced image the html points at", async () => {
    await deliver(baseConfig, { to: ["a@example.com"], email: rendered });
    const { attachments, html } = sendMailMock.mock.calls[0][0] as { attachments: { cid?: string; contentDisposition?: string; content: Buffer }[]; html: string };
    const logo = attachments.find((file) => file.cid === "elapsed-logo");
    expect(logo?.contentDisposition).toBe("inline");
    expect(Buffer.isBuffer(logo?.content)).toBe(true);
    expect(html).toContain("cid:elapsed-logo");
  });

  it("sends caller attachments (a CSV) alongside the inline logo", async () => {
    await deliver(baseConfig, {
      to: ["a@example.com"],
      email: rendered,
      attachments: [{ filename: "report.csv", content: "a,b", contentType: "text/csv" }],
    });
    const { attachments } = sendMailMock.mock.calls[0][0] as { attachments: { filename: string }[] };
    expect(attachments.map((file) => file.filename)).toEqual(["report.csv", "elapsed-logo.png"]);
  });

  it("refuses anything renderEmail did not produce, so hand-written messages can't reach the wire", async () => {
    const forged = { subject: "Hi", text: "Hi", html: "<p>Hi</p>", inlineImages: [] };
    await expect(deliver(baseConfig, { to: ["a@example.com"], email: forged as never })).rejects.toBeInstanceOf(UnrenderedEmailError);
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("propagates a send failure without swallowing it", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("Message rejected: spam"));
    await expect(deliver(baseConfig, { to: ["a@example.com"], email: rendered })).rejects.toThrow("Message rejected");
  });
});
