import type { EmailRequest } from "@sla/email";
import { EMAIL_VERIFICATION_TTL_MS } from "@sla/db";
import { getAppUrl } from "@/lib/app-url";

const EMAIL_VERIFICATION_TTL_HOURS = EMAIL_VERIFICATION_TTL_MS / (60 * 60 * 1000);

export function emailVerificationUrl(token: string): string {
  const url = new URL("/verify-email", getAppUrl());
  url.searchParams.set("token", token);
  return url.toString();
}

/** Sent to the account's current email — confirms it at sign-up (or on a resend). */
export function buildEmailVerificationEmail(input: { to: string; token: string }): EmailRequest<"email-verification"> {
  return {
    to: [input.to],
    template: "email-verification",
    data: { verifyUrl: emailVerificationUrl(input.token), ttlHours: EMAIL_VERIFICATION_TTL_HOURS },
  };
}

/** Sent to the *new* address a "change email" request targets — the change never applies until this link is clicked. */
export function buildEmailChangeVerificationEmail(input: { to: string; token: string }): EmailRequest<"email-change-verification"> {
  return {
    to: [input.to],
    template: "email-change-verification",
    data: { confirmUrl: emailVerificationUrl(input.token), ttlHours: EMAIL_VERIFICATION_TTL_HOURS },
  };
}
