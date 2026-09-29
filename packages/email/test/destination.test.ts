import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConfig } from "../src/types";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const verifyMock = vi.fn();
const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ verify: verifyMock, sendMail: sendMailMock }));
vi.mock("nodemailer", () => ({
  default: { createTransport: (...args: unknown[]) => createTransportMock(...args) },
}));

const { isPublicAddress, resolvePublicSmtpAddress, SmtpDestinationNotAllowedError } = await import("../src/destination");
const { sendEmail, verifyEmailConfig } = await import("../src/client");

const config: EmailConfig = {
  host: "smtp.customer.example",
  port: 587,
  security: "starttls",
  user: "u",
  password: "p",
  from: "a@customer.example",
  fromName: null,
};
const message = { to: ["x@example.com"], subject: "s", text: "t" };

beforeEach(() => {
  lookupMock.mockReset();
  createTransportMock.mockClear();
  verifyMock.mockReset().mockResolvedValue(true);
  sendMailMock.mockReset().mockResolvedValue({});
  delete process.env.SMTP_ALLOW_PRIVATE_HOSTS;
});

describe("isPublicAddress (F-D)", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:db8::1",
  ])("rejects %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:0808:0808::1"])(
    "accepts %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it("rejects anything that is not an IP address", () => {
    expect(isPublicAddress("localhost")).toBe(false);
    expect(isPublicAddress("not an ip")).toBe(false);
  });
});

describe("resolvePublicSmtpAddress", () => {
  it("returns a literal public IP without a lookup and refuses a private literal", async () => {
    await expect(resolvePublicSmtpAddress("8.8.8.8")).resolves.toBe("8.8.8.8");
    await expect(resolvePublicSmtpAddress("169.254.169.254")).rejects.toMatchObject({ reason: "private" });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("refuses localhost and names that resolve to loopback or private space", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(resolvePublicSmtpAddress("localhost")).rejects.toBeInstanceOf(SmtpDestinationNotAllowedError);
    lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    await expect(resolvePublicSmtpAddress("mail.internal.example")).rejects.toMatchObject({ reason: "private" });
  });

  it("refuses when ANY record is private, even if another is public", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "192.168.0.9", family: 4 }]);
    await expect(resolvePublicSmtpAddress("mixed.example")).rejects.toMatchObject({ reason: "private" });
  });

  it("reports an unresolvable name distinctly and accepts an all-public answer", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(resolvePublicSmtpAddress("nope.example")).rejects.toMatchObject({ reason: "unresolvable" });
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(resolvePublicSmtpAddress("smtp.customer.example.")).resolves.toBe("93.184.216.34");
  });
});

describe("client with publicDestinationOnly", () => {
  it("connects to the resolved address, validating the certificate for the typed name", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await verifyEmailConfig(config, { publicDestinationOnly: true });
    const options = createTransportMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.host).toBe("93.184.216.34");
    expect(options.tls).toEqual({ servername: "smtp.customer.example" });
  });

  it("refuses a private destination for verify and send, and never opens a transport", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(verifyEmailConfig({ ...config, host: "localhost" }, { publicDestinationOnly: true })).rejects.toBeInstanceOf(
      SmtpDestinationNotAllowedError,
    );
    await expect(sendEmail({ ...config, host: "localhost" }, message, { publicDestinationOnly: true })).rejects.toBeInstanceOf(
      SmtpDestinationNotAllowedError,
    );
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("does not touch operator-configured SMTP (option unset): host used as given, no lookup", async () => {
    await sendEmail({ ...config, host: "mailpit" }, message);
    expect((createTransportMock.mock.calls[0]![0] as Record<string, unknown>).host).toBe("mailpit");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("SMTP_ALLOW_PRIVATE_HOSTS=1 turns the check off for local development", async () => {
    process.env.SMTP_ALLOW_PRIVATE_HOSTS = "1";
    await verifyEmailConfig({ ...config, host: "127.0.0.1" }, { publicDestinationOnly: true });
    expect((createTransportMock.mock.calls[0]![0] as Record<string, unknown>).host).toBe("127.0.0.1");
  });
});
