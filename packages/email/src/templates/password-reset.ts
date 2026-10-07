import { defineEmailTemplate } from "../template";

export interface PasswordResetData {
  resetUrl: string;
  ttlMinutes: number;
}

export const passwordResetTemplate = defineEmailTemplate<PasswordResetData>({
  category: "account",
  subject: () => "Reset your Elapsed password",
  preheader: () => "We received a request to reset your Elapsed password.",
  footnote: () => "You are receiving this email because a password reset was requested for your Elapsed account.",
  content: ({ resetUrl, ttlMinutes }) => [
    { type: "heading", text: "Reset your password" },
    { type: "text", text: "We received a request to reset your Elapsed password." },
    { type: "button", label: "Reset your password", url: resetUrl, showUrl: true },
    { type: "note", text: `This link is single-use and expires in ${ttlMinutes} minutes.` },
    { type: "note", text: "If you didn't request this, you can safely ignore this email — your password won't change." },
  ],
});
