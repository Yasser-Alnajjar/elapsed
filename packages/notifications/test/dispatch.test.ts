import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, EmailSettingsCredentials } from "@sla/db";
import type { NotificationCandidate } from "@sla/commitments";
import { postMessage } from "@sla/slack";
import { sendEmail } from "@sla/email";
import { getEmailSettings, EmailSettingsUnreadableError } from "@sla/db";
import { runNotificationPipeline } from "../src/dispatch";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));
vi.mock("@sla/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@sla/db", async (importOriginal) => ({
  isUniqueConstraintError: (await importOriginal<typeof import("@sla/db")>()).isUniqueConstraintError,
  CASE_SOURCE_CONNECTED: (await importOriginal<typeof import("@sla/db")>()).CASE_SOURCE_CONNECTED,
  getEmailSettings: vi.fn(),
  EmailSettingsUnreadableError: class EmailSettingsUnreadableError extends Error {},
  // Fixtures below use plaintext tokens (e.g. "xoxb-1") — mirrors the real
  // decryptToken's tolerance for a not-yet-migrated plaintext value.
  decryptToken: vi.fn((value: string) => value),
}));

const postMessageMock = vi.mocked(postMessage);
const sendEmailMock = vi.mocked(sendEmail);
const getEmailSettingsMock = vi.mocked(getEmailSettings);

const emailSettings: EmailSettingsCredentials = {
  host: "smtp.example.com",
  port: 587,
  security: "starttls",
  username: "sla",
  password: "secret",
  fromEmail: "sla@example.com",
  fromName: null,
};

/** The `@sla/email` `EmailConfig` shape `dispatch.ts` builds from `emailSettings` above. */
const expectedEmailConfig = {
  host: "smtp.example.com",
  port: 587,
  security: "starttls",
  user: "sla",
  password: "secret",
  from: "sla@example.com",
  fromName: null,
};

function candidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  return {
    commitmentId: "cmt_1",
    caseId: "case_1",
    kind: "resolution",
    status: "at_risk",
    threshold: 80,
    remainingMinutes: 45,
    policyName: "Urgent SLA",
    targetMinutes: 240,
    startedAt: "2026-09-17T09:00:00.000Z",
    ...overrides,
  };
}

interface FakePrismaOptions {
  slack?: { channelId: string | null; accessToken: string } | null;
  users?: { email: string }[];
  existingNotifications?: { commitmentId: string; threshold: number }[];
  cases?: { id: string; externalId: string; subject?: string | null; customer: { name: string } | null }[];
  createImpl?: () => Promise<unknown>;
  notificationFailureUpsert?: ReturnType<typeof vi.fn>;
  notificationFailureDeleteMany?: ReturnType<typeof vi.fn>;
}

function fakePrisma(options: FakePrismaOptions = {}) {
  const {
    slack = null,
    users = [],
    existingNotifications = [],
    cases = [{ id: "case_1", externalId: "4821", subject: null, customer: { name: "Acme Co." } }],
    createImpl,
    notificationFailureUpsert = vi.fn().mockResolvedValue({}),
    notificationFailureDeleteMany = vi.fn().mockResolvedValue({}),
  } = options;

  return {
    slackIntegration: { findUnique: vi.fn().mockResolvedValue(slack) },
    user: { findMany: vi.fn().mockResolvedValue(users) },
    notification: {
      findMany: vi.fn().mockResolvedValue(existingNotifications),
      create: vi.fn(createImpl ?? (() => Promise.resolve({ id: "ntf_1" }))),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    notificationFailure: {
      upsert: notificationFailureUpsert,
      deleteMany: notificationFailureDeleteMany,
    },
    case: { findMany: vi.fn().mockResolvedValue(cases) },
    // The real client runs each op array element as a query; the fake just
    // awaits whatever promises the mocked calls above already produced.
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaClient;
}

beforeEach(() => {
  postMessageMock.mockReset().mockResolvedValue(undefined);
  sendEmailMock.mockReset().mockResolvedValue(undefined);
  getEmailSettingsMock.mockReset().mockResolvedValue(null);
});

describe("runNotificationPipeline", () => {
  it("does nothing for an empty candidate list", async () => {
    const prisma = fakePrisma();
    const result = await runNotificationPipeline(prisma, "org_1", []);
    expect(result).toEqual({ notificationsSent: 0, notificationsSkipped: 0, notificationsFailed: [] });
    expect(prisma.slackIntegration.findUnique).not.toHaveBeenCalled();
  });

  it("skips every candidate when neither Slack nor email is configured", async () => {
    const prisma = fakePrisma({ slack: null });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate(), candidate({ commitmentId: "cmt_2" })]);
    expect(result.notificationsSkipped).toBe(2);
    expect(result.notificationsSent).toBe(0);
    expect(postMessageMock).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("treats a Slack integration without a channelId as not ready", async () => {
    const prisma = fakePrisma({ slack: { channelId: null, accessToken: "xoxb-1" } });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);
    expect(result.notificationsSkipped).toBe(1);
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("sends via Slack only when email is not configured", async () => {
    const notificationFailureDeleteMany = vi.fn().mockResolvedValue({});
    const prisma = fakePrisma({ slack: { channelId: "C123", accessToken: "xoxb-1" }, notificationFailureDeleteMany });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(postMessageMock).toHaveBeenCalledWith("xoxb-1", "C123", expect.stringContaining("#4821"));
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(result.notificationsSent).toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: { commitmentId: "cmt_1", threshold: 80, channel: "pending" },
      select: { id: true },
    });
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: "ntf_1" }, data: { channel: "slack" } });
    // Phase 6.4: a successful send clears any stale failure record for this
    // (commitmentId, threshold) — best-effort, no row needs to exist.
    expect(notificationFailureDeleteMany).toHaveBeenCalledWith({
      where: { commitmentId: "cmt_1", threshold: 80 },
    });
  });

  it("claims the Notification row before sending anything", async () => {
    const prisma = fakePrisma({ slack: { channelId: "C123", accessToken: "xoxb-1" } });
    await runNotificationPipeline(prisma, "org_1", [candidate()]);

    const createOrder = vi.mocked(prisma.notification.create).mock.invocationCallOrder[0]!;
    const sendOrder = postMessageMock.mock.invocationCallOrder[0]!;
    expect(createOrder).toBeLessThan(sendOrder);
  });

  it("sends only once when two pipelines race on the same candidate", async () => {
    // Shared store with the real (commitmentId, threshold) uniqueness, and
    // both pipelines' pre-check reads see it empty — the window the post-send
    // create used to leave open.
    const claimed = new Set<string>();
    const sharedCreate = ({ data }: { data: { commitmentId: string; threshold: number } }) => {
      const key = `${data.commitmentId}:${data.threshold}`;
      if (claimed.has(key)) return Promise.reject(Object.assign(new Error("duplicate"), { code: "P2002" }));
      claimed.add(key);
      return Promise.resolve({ id: `ntf_${key}` });
    };
    const webhookRun = fakePrisma({ slack: { channelId: "C123", accessToken: "xoxb-1" } });
    const pollRun = fakePrisma({ slack: { channelId: "C123", accessToken: "xoxb-1" } });
    vi.mocked(webhookRun.notification.create).mockImplementation(sharedCreate as never);
    vi.mocked(pollRun.notification.create).mockImplementation(sharedCreate as never);

    const [a, b] = await Promise.all([
      runNotificationPipeline(webhookRun, "org_1", [candidate()]),
      runNotificationPipeline(pollRun, "org_1", [candidate()]),
    ]);

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(a.notificationsSent + b.notificationsSent).toBe(1);
    expect(a.notificationsSkipped + b.notificationsSkipped).toBe(1);
  });

  it("skips email when a row exists but the organization has no recipients", async () => {
    getEmailSettingsMock.mockResolvedValue(emailSettings);
    const prisma = fakePrisma({ slack: { channelId: "C123", accessToken: "xoxb-1" }, users: [] });
    await runNotificationPipeline(prisma, "org_1", [candidate()]);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips email when the settings row is present but undecryptable, without crashing", async () => {
    getEmailSettingsMock.mockRejectedValue(new EmailSettingsUnreadableError(new Error("bad key")));
    const prisma = fakePrisma({ slack: null, users: [{ email: "a@example.com" }] });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(result.notificationsSkipped).toBe(1);
  });

  it("propagates an unexpected error from loading email settings instead of swallowing it", async () => {
    getEmailSettingsMock.mockRejectedValue(new Error("database connection lost"));
    const prisma = fakePrisma({ slack: { channelId: "C123", accessToken: "xoxb-1" } });
    await expect(runNotificationPipeline(prisma, "org_1", [candidate()])).rejects.toThrow("database connection lost");
  });

  it("sends via both channels, using the organization's SMTP configuration, and records a combined channel string", async () => {
    getEmailSettingsMock.mockResolvedValue(emailSettings);
    const prisma = fakePrisma({
      slack: { channelId: "C123", accessToken: "xoxb-1" },
      users: [{ email: "a@example.com" }, { email: "b@example.com" }],
    });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(getEmailSettingsMock).toHaveBeenCalledWith(prisma, "org_1");
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    // 3.10: one send per recipient, never everyone in one `To`.
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    // Every message is a template request: the layout, not the dispatcher, writes subject/text/HTML.
    for (const [index, recipient] of ["a@example.com", "b@example.com"].entries()) {
      expect(sendEmailMock).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({
          to: [recipient],
          smtp: expectedEmailConfig,
          template: "sla-alert",
          data: expect.objectContaining({ ticketLabel: "#4821", kindLabel: "Resolution", severity: "at_risk" }),
          delivery: { publicDestinationOnly: true },
        }),
      );
      expect(sendEmailMock.mock.calls[index]![0]).not.toHaveProperty("html");
      expect(sendEmailMock.mock.calls[index]![0]).not.toHaveProperty("subject");
    }
    expect(result.notificationsSent).toBe(1);
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: "ntf_1" }, data: { channel: "slack,email" } });
  });

  it("keeps other recipients' delivery independent of one recipient's send failing (3.10)", async () => {
    getEmailSettingsMock.mockResolvedValue(emailSettings);
    sendEmailMock.mockImplementation((input) =>
      input.to[0] === "bad@example.com" ? Promise.reject(new Error("mailbox unavailable")) : Promise.resolve(),
    );
    const prisma = fakePrisma({
      slack: null,
      users: [{ email: "a@example.com" }, { email: "bad@example.com" }, { email: "c@example.com" }],
    });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(sendEmailMock).toHaveBeenCalledTimes(3);
    // At least one recipient succeeded, so the alert as a whole is sent —
    // the bad address doesn't block the others, and isn't retried forever.
    expect(result.notificationsSent).toBe(1);
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: "ntf_1" }, data: { channel: "email" } });
  });

  it("passes the ticket's subject to the alert template when the case has one", async () => {
    getEmailSettingsMock.mockResolvedValue(emailSettings);
    const prisma = fakePrisma({
      slack: null,
      users: [{ email: "a@example.com" }],
      cases: [{ id: "case_1", externalId: "4821", subject: "Payment webhook failing", customer: { name: "Acme Co." } }],
    });
    await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ticketName: "Payment webhook failing" }) }),
    );
  });

  it("links the alert to the ticket, and hands the deployment URL on for the footer, when an appUrl is configured", async () => {
    getEmailSettingsMock.mockResolvedValue(emailSettings);
    const prisma = fakePrisma({
      slack: null,
      users: [{ email: "a@example.com" }],
      cases: [{ id: "case_1", externalId: "4821", customer: { name: "Acme Co." } }],
    });
    await runNotificationPipeline(prisma, "org_1", [candidate()], { appUrl: "https://app.example.com" });

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appUrl: "https://app.example.com",
        data: expect.objectContaining({ caseUrl: expect.stringContaining("https://app.example.com/cases/case_1") }),
      }),
    );
  });

  it("omits the ticket link when no appUrl is configured", async () => {
    getEmailSettingsMock.mockResolvedValue(emailSettings);
    const prisma = fakePrisma({ slack: null, users: [{ email: "a@example.com" }] });
    await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ caseUrl: null }) }));
  });

  it("keeps Slack delivery independent of email failing", async () => {
    getEmailSettingsMock.mockResolvedValue(emailSettings);
    sendEmailMock.mockRejectedValueOnce(new Error("connection refused"));
    const prisma = fakePrisma({
      slack: { channelId: "C123", accessToken: "xoxb-1" },
      users: [{ email: "a@example.com" }],
    });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(result.notificationsSent).toBe(1);
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: "ntf_1" }, data: { channel: "slack" } });
  });

  it("skips a candidate already recorded for that (commitmentId, threshold) — dedup unchanged", async () => {
    const prisma = fakePrisma({
      slack: { channelId: "C123", accessToken: "xoxb-1" },
      existingNotifications: [{ commitmentId: "cmt_1", threshold: 80 }],
    });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(result.notificationsSkipped).toBe(1);
    expect(result.notificationsSent).toBe(0);
    expect(postMessageMock).not.toHaveBeenCalled();
    expect(prisma.case.findMany).not.toHaveBeenCalled();
  });

  it("only re-attempts the candidates not already recorded", async () => {
    const prisma = fakePrisma({
      slack: { channelId: "C123", accessToken: "xoxb-1" },
      existingNotifications: [{ commitmentId: "cmt_1", threshold: 80 }],
      cases: [{ id: "case_1", externalId: "4821", customer: { name: "Acme Co." } }],
    });
    const result = await runNotificationPipeline(prisma, "org_1", [
      candidate(),
      candidate({ commitmentId: "cmt_2", threshold: 95 }),
    ]);

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(result.notificationsSkipped).toBe(1);
    expect(result.notificationsSent).toBe(1);
  });

  it("still counts the candidate as sent when only one of two channels delivers", async () => {
    getEmailSettingsMock.mockResolvedValue(emailSettings);
    postMessageMock.mockRejectedValueOnce(new Error("channel_not_found"));
    const prisma = fakePrisma({
      slack: { channelId: "C123", accessToken: "xoxb-1" },
      users: [{ email: "a@example.com" }],
    });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(result.notificationsSent).toBe(1);
    expect(result.notificationsFailed).toEqual([]);
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: "ntf_1" }, data: { channel: "email" } });
  });

  it("records a failure with a combined error message when every channel fails", async () => {
    getEmailSettingsMock.mockResolvedValue(emailSettings);
    postMessageMock.mockRejectedValueOnce(new Error("channel_not_found"));
    sendEmailMock.mockRejectedValueOnce(new Error("connection refused"));
    const notificationFailureUpsert = vi.fn().mockResolvedValue({});
    const prisma = fakePrisma({
      slack: { channelId: "C123", accessToken: "xoxb-1" },
      users: [{ email: "a@example.com" }],
      notificationFailureUpsert,
    });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(result.notificationsSent).toBe(0);
    expect(result.notificationsFailed).toEqual([
      { commitmentId: "cmt_1", threshold: 80, error: "slack: channel_not_found; email: a@example.com: connection refused" },
    ]);
    // The claim is released so a later cycle retries this alert.
    expect(prisma.notification.delete).toHaveBeenCalledWith({ where: { id: "ntf_1" } });
    expect(prisma.notification.update).not.toHaveBeenCalled();
    // Phase 6.4: a durable record survives the claim's release, so the
    // dashboard's failed-deliveries panel has something to show.
    expect(notificationFailureUpsert).toHaveBeenCalledWith({
      where: { commitmentId_threshold: { commitmentId: "cmt_1", threshold: 80 } },
      create: {
        commitmentId: "cmt_1",
        threshold: 80,
        error: "slack: channel_not_found; email: a@example.com: connection refused",
      },
      update: expect.objectContaining({
        error: "slack: channel_not_found; email: a@example.com: connection refused",
        attempts: { increment: 1 },
      }),
    });
  });

  it("treats a unique-constraint race on the claim as skipped, without sending", async () => {
    const prisma = fakePrisma({
      slack: { channelId: "C123", accessToken: "xoxb-1" },
      createImpl: () => Promise.reject(Object.assign(new Error("duplicate"), { code: "P2002" })),
    });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(result.notificationsSent).toBe(0);
    expect(result.notificationsSkipped).toBe(1);
    expect(result.notificationsFailed).toEqual([]);
    expect(postMessageMock).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it("propagates a claim error that is not a unique-constraint violation, without sending", async () => {
    const prisma = fakePrisma({
      slack: { channelId: "C123", accessToken: "xoxb-1" },
      createImpl: () => Promise.reject(new Error("connection lost")),
    });
    await expect(runNotificationPipeline(prisma, "org_1", [candidate()])).rejects.toThrow("connection lost");
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("silently drops a candidate whose case has since been deleted", async () => {
    const prisma = fakePrisma({ slack: { channelId: "C123", accessToken: "xoxb-1" }, cases: [] });
    const result = await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
    expect(result.notificationsSent).toBe(0);
    expect(result.notificationsFailed).toEqual([]);
  });

  it("omits the customer clause when the case has none", async () => {
    const prisma = fakePrisma({
      slack: { channelId: "C123", accessToken: "xoxb-1" },
      cases: [{ id: "case_1", externalId: "4821", customer: null }],
    });
    await runNotificationPipeline(prisma, "org_1", [candidate()]);

    expect(postMessageMock).toHaveBeenCalledWith("xoxb-1", "C123", expect.not.stringContaining("for "));
  });
});
