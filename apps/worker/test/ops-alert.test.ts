import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { loadOpsAlertConfig, sendOpsAlert } = await import("../src/ops-alert");

const OPS_VARS = ["OPS_ALERT_SLACK_WEBHOOK_URL", "OPS_ALERT_EMAIL"] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};
const CONFIGURED_SMTP = {
  host: "smtp.deployment.example.com",
  port: 587,
  security: "starttls" as const,
  user: "deployment-user",
  password: "deployment-password",
  from: "no-reply@example.com",
};

beforeEach(() => {
  for (const name of OPS_VARS) {
    ORIGINAL_ENV[name] = process.env[name];
    delete process.env[name];
  }
  sendEmailMock.mockReset();
  loadDeploymentSmtpConfigMock.mockReset();
});

afterEach(() => {
  for (const name of OPS_VARS) {
    if (ORIGINAL_ENV[name] === undefined) delete process.env[name];
    else process.env[name] = ORIGINAL_ENV[name];
  }
});

describe("loadOpsAlertConfig", () => {
  it("returns null when neither channel is configured", () => {
    expect(loadOpsAlertConfig()).toBeNull();
    expect(loadDeploymentSmtpConfigMock).not.toHaveBeenCalled();
  });

  it("configures only Slack when OPS_ALERT_SLACK_WEBHOOK_URL is set but OPS_ALERT_EMAIL isn't", () => {
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.example/abc";

    const config = loadOpsAlertConfig();

    expect(config).toEqual({ slackWebhookUrl: "https://hooks.slack.example/abc", email: null });
    expect(loadDeploymentSmtpConfigMock).not.toHaveBeenCalled();
  });

  it("leaves the email channel off (not an error) when OPS_ALERT_EMAIL is set but the shared deployment SMTP isn't configured, so with no Slack webhook either the whole config is null", () => {
    process.env.OPS_ALERT_EMAIL = "ops@example.com";
    loadDeploymentSmtpConfigMock.mockImplementation(() => {
      throw new FakeDeploymentSmtpNotConfiguredError(["DEPLOYMENT_SMTP_HOST"]);
    });

    expect(loadOpsAlertConfig()).toBeNull();
  });

  it("leaves the email channel off but keeps the config when Slack is also configured", () => {
    process.env.OPS_ALERT_EMAIL = "ops@example.com";
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.example/abc";
    loadDeploymentSmtpConfigMock.mockImplementation(() => {
      throw new FakeDeploymentSmtpNotConfiguredError(["DEPLOYMENT_SMTP_HOST"]);
    });

    const config = loadOpsAlertConfig();

    expect(config).toEqual({ slackWebhookUrl: "https://hooks.slack.example/abc", email: null });
  });

  it("builds the email channel from the shared DEPLOYMENT_SMTP_* config when both OPS_ALERT_EMAIL and deployment SMTP are set", () => {
    process.env.OPS_ALERT_EMAIL = "ops@example.com";
    loadDeploymentSmtpConfigMock.mockReturnValue(CONFIGURED_SMTP);

    const config = loadOpsAlertConfig();

    expect(config).toEqual({
      slackWebhookUrl: null,
      email: { to: "ops@example.com", smtp: CONFIGURED_SMTP },
    });
  });

  it("rethrows an unexpected error from the shared loader rather than silently treating it as unconfigured", () => {
    process.env.OPS_ALERT_EMAIL = "ops@example.com";
    loadDeploymentSmtpConfigMock.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => loadOpsAlertConfig()).toThrow("boom");
  });
});

describe("sendOpsAlert", () => {
  it("sends through the shared transport with the ops recipient and deployment SMTP config", async () => {
    process.env.OPS_ALERT_EMAIL = "ops@example.com";
    loadDeploymentSmtpConfigMock.mockReturnValue(CONFIGURED_SMTP);
    sendEmailMock.mockResolvedValue(undefined);
    const config = loadOpsAlertConfig();

    await sendOpsAlert(config, { subject: "Worker stalled", message: "No successful cycle in 15 minutes." });

    // A template request, not a hand-written message: the layout renders subject, text and HTML.
    expect(sendEmailMock).toHaveBeenCalledWith({
      smtp: CONFIGURED_SMTP,
      to: ["ops@example.com"],
      template: "ops-alert",
      data: { subject: "Worker stalled", message: "No successful cycle in 15 minutes." },
    });
  });

  it("marks a recovery alert as such", async () => {
    process.env.OPS_ALERT_EMAIL = "ops@example.com";
    loadDeploymentSmtpConfigMock.mockReturnValue(CONFIGURED_SMTP);
    sendEmailMock.mockResolvedValue(undefined);

    await sendOpsAlert(loadOpsAlertConfig(), { subject: "Worker recovered", message: "Serviced again.", kind: "recovered" });

    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ template: "ops-alert", data: expect.objectContaining({ kind: "recovered" }) }));
  });

  it("logs, rather than throws, when the email send fails, so the watchdog loop survives", async () => {
    process.env.OPS_ALERT_EMAIL = "ops@example.com";
    loadDeploymentSmtpConfigMock.mockReturnValue(CONFIGURED_SMTP);
    sendEmailMock.mockRejectedValue(new Error("smtp down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(sendOpsAlert(loadOpsAlertConfig(), { subject: "Worker stalled", message: "m" })).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("ops_alert_email_failed"));
    logged.mockRestore();
  });

  it("does nothing when config is null", async () => {
    await sendOpsAlert(null, { subject: "Worker stalled", message: "No successful cycle in 15 minutes." });

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
