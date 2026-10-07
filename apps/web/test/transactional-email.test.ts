import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConfig, EmailRequest } from "@sla/email";

const sendEmailMock = vi.fn();
const loadDeploymentSmtpConfigMock = vi.fn();

class FakeDeploymentSmtpNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Deployment SMTP is not configured: missing ${missing.join(", ")}`);
    this.name = "DeploymentSmtpNotConfiguredError";
  }
}

vi.mock("@sla/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  loadDeploymentSmtpConfig: () => loadDeploymentSmtpConfigMock(),
  DeploymentSmtpNotConfiguredError: FakeDeploymentSmtpNotConfiguredError,
}));

const { sendTransactionalEmail } = await import("../src/lib/transactional-email");

const CONFIGURED: EmailConfig = {
  host: "smtp.deployment.example.com",
  port: 587,
  security: "starttls",
  user: "deployment-user",
  password: "deployment-password",
  from: "no-reply@example.com",
};

const REQUEST: EmailRequest<"invitation"> = {
  to: ["invitee@example.com"],
  template: "invitation",
  data: { organizationName: "Acme", acceptUrl: "https://sla.example.com/invite/accept?token=t", ttlDays: 7 },
};

beforeEach(() => {
  sendEmailMock.mockReset();
  loadDeploymentSmtpConfigMock.mockReset();
});

describe("sendTransactionalEmail", () => {
  it("loads the deployment SMTP config and sends through the shared @sla/email transport", async () => {
    loadDeploymentSmtpConfigMock.mockReturnValue(CONFIGURED);
    sendEmailMock.mockResolvedValue(undefined);

    await sendTransactionalEmail(REQUEST);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    // The request goes through untouched, plus the deployment SMTP to deliver it: no subject or body is added or accepted here.
    expect(sendEmailMock).toHaveBeenCalledWith({ ...REQUEST, smtp: CONFIGURED });
  });

  it("propagates a not-configured error and never calls sendEmail", async () => {
    loadDeploymentSmtpConfigMock.mockImplementation(() => {
      throw new FakeDeploymentSmtpNotConfiguredError(["DEPLOYMENT_SMTP_HOST"]);
    });

    await expect(
      sendTransactionalEmail(REQUEST),
    ).rejects.toBeInstanceOf(FakeDeploymentSmtpNotConfiguredError);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("propagates a delivery failure from sendEmail rather than swallowing it", async () => {
    loadDeploymentSmtpConfigMock.mockReturnValue(CONFIGURED);
    sendEmailMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      sendTransactionalEmail(REQUEST),
    ).rejects.toThrow("connection refused");
  });
});
