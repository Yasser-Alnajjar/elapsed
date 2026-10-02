import type { CommitmentKind } from "@sla/core";
import type { IntegrationProvider } from "./integrations";

/** Cross-organization equivalent of `IntegrationHealthRow` (roadmap 7.5) — only unhealthy rows, so this never lists a fine integration for every org on the deployment. */
export interface OperatorIntegrationHealthRow {
  organizationId: string;
  organizationName: string | null;
  provider: IntegrationProvider;
  reauthRequired: boolean;
  permissionDenied: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastSuccessfulSyncAt: string | null;
  consecutiveFailures: number;
  failingSince: string | null;
  lastSyncDurationMs: number | null;
  /** A platform operator paused polling (N4.5): it is stale or failing on purpose, not by accident. */
  pollingPausedAt: string | null;
  /** No successful sync within the freshness window (N3), even with no recorded error. */
  stale: boolean;
  /** When it went stale; null when it has never synced successfully. */
  staleSince: string | null;
}

/** Cross-organization equivalent of `FailedAlertRow` (roadmap 7.5). */
export interface OperatorFailedAlertRow {
  organizationId: string;
  organizationName: string | null;
  commitmentId: string;
  caseId: string;
  externalId: string;
  subject: string | null;
  kind: CommitmentKind;
  threshold: number;
  error: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
}

/** One integration that is syncing cleanly: shown collapsed on the overview, so the operator can see what "fine" looks like. */
export interface OperatorHealthyIntegrationRow {
  organizationId: string;
  organizationName: string | null;
  provider: IntegrationProvider;
  lastSuccessfulSyncAt: string | null;
}

/**
 * Read model for the platform-operator monitoring view (roadmap 7.5) — the
 * only page in the app that spans every organization on the deployment
 * rather than the signed-in user's own. Gated by `isPlatformOperator`;
 * `getOperatorMonitoringData` is never called for a non-operator session.
 */
export interface OperatorMonitoringData {
  asOf: string;
  organizationCount: number;
  unhealthyIntegrations: OperatorIntegrationHealthRow[];
  failedAlerts: OperatorFailedAlertRow[];
  failedAlertsOverflowCount: number;
  /** Connected (not disconnected) integrations on the whole deployment. */
  connectedIntegrationCount: number;
  /** Of those, how many are syncing cleanly, i.e. not in `unhealthyIntegrations`. */
  healthyIntegrationCount: number;
  /** A capped sample of the healthy ones (`healthyIntegrationCount` is the real total). */
  healthyIntegrations: OperatorHealthyIntegrationRow[];
}
