import { DEFAULT_EXPORT_SINCE_DAYS, type ConciergeSourceProvider } from "./types/concierge-export";

/** Per-provider wording and routes for the Concierge export pages. */
export interface ConciergeProviderCopy {
  label: string;
  title: string;
  exportHref: string;
  integrationHref: string;
  sourceDescription: string;
  exportButton: string;
  recordNoun: string;
  historyNoun: string;
  /** What the export window is measured against, e.g. "Issues updated". */
  scopeRecords: string;
  /** Where status history comes from, e.g. "Jira changelog". */
  historySource: string;
  /** Files in the exported ZIP, in archive order. */
  archiveFiles: { name: string; description: string }[];
}

export const CONCIERGE_PROVIDER_COPY: Record<ConciergeSourceProvider, ConciergeProviderCopy> = {
  jira: {
    label: "Jira",
    title: "Jira Concierge Export",
    exportHref: "/internal/concierge/jira-export",
    integrationHref: "/settings/integrations/jira",
    sourceDescription: `Issues updated in the last ${DEFAULT_EXPORT_SINCE_DAYS} days, with their status history from Jira's changelog.`,
    exportButton: "Export Jira Concierge Data",
    recordNoun: "Jira issues",
    historyNoun: "changelog entries",
    scopeRecords: "Issues updated",
    historySource: "Jira changelog",
    archiveFiles: [
      { name: "jira-issues.csv", description: "One row per issue" },
      { name: "jira-changelog.csv", description: "Status transitions per issue" },
      { name: "metadata.json", description: "Export window, counts and JQL" },
    ],
  },
  zendesk: {
    label: "Zendesk",
    title: "Zendesk Concierge Export",
    exportHref: "/internal/concierge/zendesk-export",
    integrationHref: "/settings/integrations/zendesk",
    sourceDescription: `Tickets updated in the last ${DEFAULT_EXPORT_SINCE_DAYS} days, with their status changes from Zendesk's ticket audits.`,
    exportButton: "Export Zendesk Concierge Data",
    recordNoun: "Zendesk tickets",
    historyNoun: "status changes",
    scopeRecords: "Tickets updated",
    historySource: "Ticket audits",
    archiveFiles: [
      { name: "zendesk-tickets.csv", description: "One row per ticket" },
      { name: "zendesk-audits.csv", description: "Status changes per ticket" },
      { name: "metadata.json", description: "Export window, counts and Jira links" },
    ],
  },
};
