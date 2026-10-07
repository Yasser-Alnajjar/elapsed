import { defineEmailTemplate } from "../template";
import { strong } from "../blocks";

export interface InvitationData {
  organizationName: string;
  acceptUrl: string;
  ttlDays: number;
}

export const invitationTemplate = defineEmailTemplate<InvitationData>({
  category: "account",
  subject: ({ organizationName }) => `You've been invited to join ${organizationName} on Elapsed`,
  preheader: ({ organizationName }) => `You've been invited to join ${organizationName} on Elapsed.`,
  footnote: ({ organizationName }) => `You are receiving this email because this address was invited to join ${organizationName} on Elapsed.`,
  content: ({ organizationName, acceptUrl, ttlDays }) => [
    { type: "heading", text: "You've been invited" },
    { type: "text", text: ["You've been invited to join ", strong(organizationName), " on Elapsed."] },
    { type: "button", label: "Accept the invitation", url: acceptUrl, showUrl: true },
    { type: "note", text: `This link is single-use and expires in ${ttlDays} days.` },
  ],
});
