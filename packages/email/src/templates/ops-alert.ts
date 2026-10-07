import { defineEmailTemplate } from "../template";

export interface OpsAlertData {
  /** The alert's own title, e.g. "SLA worker stalled: reconciliation_sweep". Also the subject. */
  subject: string;
  message: string;
  /** `recovered` closes out an earlier alert. Defaults to `alert`. */
  kind?: "alert" | "recovered";
}

/** Deployment-owner alerting from the worker — "email to you, not to a customer". */
export const opsAlertTemplate = defineEmailTemplate<OpsAlertData>({
  category: "operations",
  subject: ({ subject }) => subject,
  preheader: ({ message }) => message,
  footnote: () => "You are receiving this operational alert as the owner of this Elapsed deployment.",
  content: ({ subject, message, kind }) => [
    kind === "recovered"
      ? { type: "badge", tone: "success", text: "Recovered" }
      : { type: "badge", tone: "danger", text: "Operational alert" },
    { type: "heading", text: subject },
    { type: "text", text: message },
  ],
});
