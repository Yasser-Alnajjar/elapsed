import type { IntegrationDataCounts } from "@sla/db";
import type { IntegrationProvider } from "./integrations";

export type { IntegrationDataCounts };

export type IntegrationConnectionStatus =
  | "connected"
  | "disconnected"
  | "reauth_required"
  | "permission_denied";

/** One integration that holds stored data, as the Settings → Data table shows it. */
export interface IntegrationDataRow {
  integrationId: string;
  provider: IntegrationProvider;
  status: IntegrationConnectionStatus;
  connectedAt: Date;
  disconnectedAt: Date | null;
  lastSyncAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  counts: IntegrationDataCounts;
  /** Every stored record of this integration, across all types. */
  total: number;
}

/** One backup or cleanup, from the tenant-visible audit trail. */
export interface DataOperationRow {
  id: string;
  provider: IntegrationProvider;
  kind: "backup" | "cleanup";
  /** The download format id (`ndjson`, `json`, `csv`, `pdf`); null for a cleanup. */
  format: string | null;
  status: "started" | "completed" | "failed";
  actorEmail: string;
  startedAt: Date;
  finishedAt: Date | null;
  /** Records the operation covered, when known. */
  records: number | null;
  error: string | null;
}

/** Read model for `/settings/data`. */
export interface DataPageData {
  /** Only an organization owner can back up or clean up; anyone signed in can see what is stored. */
  canManage: boolean;
  /** Integrations with at least one stored record — connected or not. */
  integrations: IntegrationDataRow[];
  /** Most recent first. */
  operations: DataOperationRow[];
}

/** Every count a backup, export or cleanup covers, in the order a user reads them. */
export const DATA_COUNT_LINES: { key: keyof IntegrationDataCounts; label: string; hint?: string }[] = [
  { key: "cases", label: "Cases", hint: "with their SLA commitments and history" },
  { key: "normalizedEvents", label: "Events", hint: "status changes, replies, issue links" },
  { key: "commitments", label: "Commitments" },
  { key: "evaluations", label: "Evaluations", hint: "SLA clock snapshots" },
  { key: "rawEvents", label: "Raw records", hint: "exactly as the provider returned them" },
  { key: "caseLinks", label: "Links", hint: "case ↔ issue" },
  { key: "customerIdentities", label: "Customer identities" },
  { key: "other", label: "Other records", hint: "alerts, policy changes" },
];
