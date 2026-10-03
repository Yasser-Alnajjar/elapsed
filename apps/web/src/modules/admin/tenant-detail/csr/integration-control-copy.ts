import { Pause, Play, RefreshCw, type LucideIcon } from "lucide-react";
import type { IntegrationControl } from "@/lib/types/admin";

export interface ControlCopy {
  caption: string;
  title: (tenant: string) => string;
  body: (provider: string) => string;
  /** What the customer will notice, or null when nothing changes for them. */
  consequence: ((provider: string) => string) | null;
  confirm: string;
  icon: LucideIcon;
  /** Only pausing has a customer-visible downside; resume and re-normalize are routine. */
  tone: "warning" | "primary";
}

/** Wording, icon and tone for each operator control's button and confirmation. */
export const CONTROL_COPY: Record<IntegrationControl, ControlCopy> = {
  pause_polling: {
    caption: "Operator intervention · recorded in the audit log",
    title: (tenant) => `Pause polling for ${tenant}?`,
    body: (provider) =>
      `The worker stops fetching from ${provider} for this organization until you resume. Evaluation keeps running on the data already stored, but no new data arrives, so the customer sees this integration as stale ("paused by Elapsed support") and breach alerts for its cases are held.`,
    consequence: (provider) =>
      `The customer's ${provider} integration will show as stale, and breach alerts for its cases are held until you resume. Timestamps already stored are not changed.`,
    confirm: "Pause polling",
    icon: Pause,
    tone: "warning",
  },
  resume_polling: {
    caption: "Operator action · recorded in the audit log",
    title: (tenant) => `Resume polling for ${tenant}?`,
    body: (provider) =>
      `The worker fetches from ${provider} again on its next run.`,
    consequence: null,
    confirm: "Resume polling",
    icon: Play,
    tone: "primary",
  },
  request_renormalize: {
    caption: "Operator action · recorded in the audit log",
    title: (tenant) => `Re-normalize ${tenant}?`,
    body: (provider) =>
      `On its next run the worker rebuilds every ${provider} case from the raw events already stored (a full pass instead of the incremental one), then clears the request. It fetches nothing and edits no tenant data.`,
    consequence: null,
    confirm: "Request re-normalization",
    icon: RefreshCw,
    tone: "primary",
  },
};
