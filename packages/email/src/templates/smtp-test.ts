import { defineEmailTemplate } from "../template";

export interface SmtpTestData {
  /** The organization's configured "from name", when it set one. */
  senderName?: string | null;
}

/** "Send test email" from Settings → Notifications: proves delivery through the organization's own SMTP server. */
export const smtpTestTemplate = defineEmailTemplate<SmtpTestData>({
  category: "operations",
  notificationSettingsLink: true,
  subject: () => "Elapsed — Test Email",
  preheader: () => "Your SMTP configuration for Elapsed is working correctly.",
  footnote: ({ senderName }) =>
    `You are receiving this test message because it was requested from your notification settings${senderName?.trim() ? ` on behalf of ${senderName.trim()}` : ""}.`,
  content: () => [
    { type: "badge", tone: "success", text: "Test email" },
    { type: "heading", text: "Your SMTP configuration works" },
    { type: "text", text: "This is a test email confirming your SMTP configuration for Elapsed is working correctly." },
    { type: "text", text: "If you received this, at-risk and breach alerts will be delivered to this organization's users the same way, using this branding." },
  ],
});
