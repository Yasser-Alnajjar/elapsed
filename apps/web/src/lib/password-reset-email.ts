import type { EmailRequest } from "@sla/email";
import { PASSWORD_RESET_TTL_MS } from "@sla/db";
import { getAppUrl } from "@/lib/app-url";

const PASSWORD_RESET_TTL_MINUTES = PASSWORD_RESET_TTL_MS / (60 * 1000);

export function passwordResetUrl(token: string): string {
  const url = new URL("/reset-password", getAppUrl());
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildPasswordResetEmail(input: { to: string; token: string }): EmailRequest<"password-reset"> {
  return {
    to: [input.to],
    template: "password-reset",
    data: { resetUrl: passwordResetUrl(input.token), ttlMinutes: PASSWORD_RESET_TTL_MINUTES },
  };
}
