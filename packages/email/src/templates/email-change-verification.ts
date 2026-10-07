import { defineEmailTemplate } from "../template";

export interface EmailChangeVerificationData {
  confirmUrl: string;
  ttlHours: number;
}

/** Sent to the *new* address a "change email" request targets — the change never applies until this link is clicked. */
export const emailChangeVerificationTemplate = defineEmailTemplate<EmailChangeVerificationData>({
  category: "account",
  subject: () => "Confirm your new email for Elapsed",
  preheader: () => "Confirm the new email address for your Elapsed account.",
  footnote: () => "You are receiving this email because a change to this address was requested for an Elapsed account.",
  content: ({ confirmUrl, ttlHours }) => [
    { type: "heading", text: "Confirm your new email" },
    { type: "text", text: "We received a request to change the email on an Elapsed account to this address." },
    { type: "button", label: "Confirm this change", url: confirmUrl, showUrl: true },
    { type: "note", text: `This link is single-use and expires in ${ttlHours} hours.` },
    { type: "note", text: "If you didn't request this, you can safely ignore this email — the account's email won't change." },
  ],
});
