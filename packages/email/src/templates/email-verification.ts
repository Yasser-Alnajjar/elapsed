import { defineEmailTemplate } from "../template";

export interface EmailVerificationData {
  verifyUrl: string;
  ttlHours: number;
}

/** Sent to the account's current email — confirms it at sign-up (or on a resend). */
export const emailVerificationTemplate = defineEmailTemplate<EmailVerificationData>({
  category: "account",
  subject: () => "Verify your email for Elapsed",
  preheader: () => "Confirm this is your email address to finish setting up Elapsed.",
  footnote: () => "You are receiving this email because this address was used to create an Elapsed account.",
  content: ({ verifyUrl, ttlHours }) => [
    { type: "heading", text: "Verify your email" },
    { type: "text", text: "Confirm this is your email address to finish setting up Elapsed." },
    { type: "button", label: "Verify your email", url: verifyUrl, showUrl: true },
    { type: "note", text: `This link is single-use and expires in ${ttlHours} hours.` },
  ],
});
