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
}
