import type { EmailRequest } from "@sla/email";
import { INVITATION_TTL_MS } from "@sla/db";
import { getAppUrl } from "@/lib/app-url";

const INVITATION_TTL_DAYS = INVITATION_TTL_MS / (24 * 60 * 60 * 1000);

export function invitationAcceptUrl(token: string): string {
  const url = new URL("/invite/accept", getAppUrl());
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildInvitationEmail(input: {
  to: string;
  organizationName: string;
  token: string;
}): EmailRequest<"invitation"> {
  return {
    to: [input.to],
    template: "invitation",
    data: { organizationName: input.organizationName, acceptUrl: invitationAcceptUrl(input.token), ttlDays: INVITATION_TTL_DAYS },
  };
}
