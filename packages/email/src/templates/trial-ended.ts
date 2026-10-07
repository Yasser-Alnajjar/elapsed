import { defineEmailTemplate } from "../template";
import type { EmailBlock } from "../blocks";

export interface TrialEndedData {
  organizationName: string;
  /** Link to the plans page; null when the deployment has no public URL configured. */
  pricingUrl: string | null;
}

/** The owner email for a lapsed trial. Nothing is switched off, and the email says so. */
export const trialEndedTemplate = defineEmailTemplate<TrialEndedData>({
  category: "account",
  subject: ({ organizationName }) => `Your Elapsed trial for ${organizationName} has ended`,
  preheader: () => "Nothing is switched off: your cases, SLA monitoring and alerts keep working.",
  footnote: ({ organizationName }) => `You are receiving this email because you own ${organizationName} on Elapsed.`,
  content: ({ organizationName, pricingUrl }) => {
    const blocks: EmailBlock[] = [
      { type: "badge", tone: "info", text: "Trial ended" },
      { type: "heading", text: `The trial for ${organizationName} has ended` },
      { type: "text", text: "Nothing is switched off: your cases, SLA monitoring, alerts, dashboard and history keep working." },
      { type: "text", text: "Until you upgrade, adding new configuration (members, integrations and SLA policies) is paused." },
    ];
    if (pricingUrl) blocks.push({ type: "button", label: "See plans", url: pricingUrl });
    blocks.push({ type: "note", text: "Reply to this email if you want to talk to us." });
    return blocks;
  },
});
