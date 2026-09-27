/** The integrations a Concierge dataset is exported from. */
export type ConciergeSourceProvider = "jira" | "zendesk";

/** Records updated in this many days are exported unless a request says otherwise; same window as the backfills. */
export const DEFAULT_EXPORT_SINCE_DAYS = 90;
export const MAX_EXPORT_SINCE_DAYS = 730;

/** An organization the signed-in user may export from. Display-only fields. */
export interface ConciergeOrganizationOption {
  id: string;
  name: string;
}

/**
 * An integration as the export page shows it. Never carries `credentials`
 * or tokens — only what an operator needs to pick one.
 */
export interface ConciergeIntegrationOption {
  id: string;
  organizationId: string;
  /** e.g. "Jira Cloud (acme.atlassian.net)", "Zendesk (acme.zendesk.com)". */
  name: string;
  /** False when disconnected or awaiting reauthorization: listed, but not exportable. */
  exportable: boolean;
  unavailableReason: string | null;
}

export interface ConciergeExportPageData {
  provider: ConciergeSourceProvider;
  organizations: ConciergeOrganizationOption[];
  /**
   * Integrations for the organization selected on first render (the only
   * one, when there is exactly one). Empty otherwise: the page loads them
   * once the operator picks an organization.
   */
  initialOrganizationId: string | null;
  initialIntegrations: ConciergeIntegrationOption[];
}

/** What the page resolved. Each provider's route names the integration id in its own body field. */
export interface ConciergeExportSelectionRequest {
  organizationId: string;
  integrationId: string;
}

export interface JiraConciergeExportRequest {
  organizationId: string;
  jiraIntegrationId: string;
  /** Issues updated in the last N days. Defaults to 90, like the backfill. */
  sinceDays?: number;
}

export interface ZendeskConciergeExportRequest {
  organizationId: string;
  zendeskIntegrationId: string;
  /** Tickets updated in the last N days. Defaults to 90, like the backfill. */
  sinceDays?: number;
}

interface ConciergeExportMetadataBase {
  version: 1;
  exportedAt: string;
  organizationId: string;
  sinceDays: number;
  files: string[];
}

export interface JiraConciergeExportMetadata extends ConciergeExportMetadataBase {
  format: "jira-concierge-export";
  jiraIntegrationId: string;
  siteUrl: string;
  jql: string;
  issueCount: number;
  changelogEntryCount: number;
  statusCount: number;
}

export interface ZendeskConciergeExportMetadata extends ConciergeExportMetadataBase {
  format: "zendesk-concierge-export";
  zendeskIntegrationId: string;
  subdomain: string;
  startTime: number;
  ticketCount: number;
  statusChangeCount: number;
  jiraLinkCount: number;
  jiraLinksUnavailable: boolean;
  skippedTicketIds: number[];
}

/**
 * Counts read back from the export response headers: records are Jira issues
 * or Zendesk tickets, history entries are changelog status transitions or
 * Zendesk status-change audit events.
 */
export interface ConciergeExportSummary {
  recordCount: number;
  historyCount: number;
  fileName: string;
}

export interface SelectionFieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}
