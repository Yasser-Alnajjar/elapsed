import { CheckCircle2, PlugZap, ShieldAlert, Ticket } from "lucide-react";
import { formatCommitmentKind, formatExactTimestamp } from "@/lib/format";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import type {
  FailedAlertRow,
  IntegrationHealthRow,
  UnmatchedCaseRow,
} from "@/lib/types/dashboard";

interface BlindSpotsPanelProps {
  unmatchedCases: UnmatchedCaseRow[];
  unmatchedOverflowCount: number;
  integrationHealth: IntegrationHealthRow[];
  failedAlerts: FailedAlertRow[];
  failedAlertsOverflowCount: number;
}

function SubSection({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="text-outline size-4" />
          <div>
            <h4 className="text-on-surface text-sm font-medium">{title}</h4>
            <p className="text-outline text-xs">{description}</p>
          </div>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

/**
 * Everything the KPI tiles and charts can't show because it's the *absence*
 * of monitoring, not an SLA outcome: a case with no matching policy has no
 * commitment to evaluate, a broken integration stops feeding events silently,
 * and a failed alert delivery leaves no `Notification` row to render elsewhere.
 */
export function BlindSpotsPanel({
  unmatchedCases,
  unmatchedOverflowCount,
  integrationHealth,
  failedAlerts,
  failedAlertsOverflowCount,
}: BlindSpotsPanelProps) {
  const unhealthyIntegrations = integrationHealth.filter(
    (row) => row.reauthRequired || row.permissionDenied || row.lastSyncError || row.failingSince || row.stale,
  );

  return (
    <div className="bg-surface-container-low shadow-soft flex flex-col gap-5 overflow-hidden rounded-xl p-4">
      <div>
        <h3 className="text-on-surface text-base font-medium">Blind Spots</h3>
        <p className="text-outline text-sm">
          Cases, integrations, and alerts that are silently not being monitored
        </p>
      </div>

      <SubSection
        icon={Ticket}
        title="Open cases with no matching SLA policy"
        description="No active policy version matched this case's attributes — it has no SLA commitment at all"
        badge={
          unmatchedCases.length > 0 && (
            <span className="bg-warning/15 text-warning rounded px-2 py-0.5 font-mono text-xs">
              {unmatchedCases.length + unmatchedOverflowCount}
            </span>
          )
        }
      >
        {unmatchedCases.length === 0 ? (
          <p className="text-outline flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="text-tertiary size-3.5" />
            Every open case matches a policy.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {unmatchedCases.map((row) => (
              <li key={row.caseId} className="flex items-center justify-between gap-2 text-sm">
                <a href={`/cases/${row.caseId}`} className="text-primary truncate hover:underline">
                  #{row.externalId} {row.subject ?? ""}
                </a>
                <span className="text-outline shrink-0 font-mono text-xxs">
                  {row.customerName ?? "No customer"}
                </span>
              </li>
            ))}
            {unmatchedOverflowCount > 0 && (
              <li className="text-outline text-xs">+{unmatchedOverflowCount} more.</li>
            )}
          </ul>
        )}
      </SubSection>

      <SubSection
        icon={PlugZap}
        title="Integration health"
        description="Re-auth needed, lost provider access, the last sync failed, or data has gone stale"
        badge={
          unhealthyIntegrations.length > 0 && (
            <span className="bg-error/15 text-error rounded px-2 py-0.5 font-mono text-xs">
              {unhealthyIntegrations.length}
            </span>
          )
        }
      >
        {integrationHealth.length === 0 ? (
          <p className="text-outline text-xs">No integrations connected yet.</p>
        ) : unhealthyIntegrations.length === 0 ? (
          <p className="text-outline flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="text-tertiary size-3.5" />
            Every connected integration is syncing cleanly.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {unhealthyIntegrations.map((row) => (
              <li key={row.provider} className="flex flex-col gap-0.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-on-surface font-medium">
                    {INTEGRATION_PROVIDER_LABELS[row.provider]}
                  </span>
                  <a
                    href={`/settings/integrations/${row.provider}`}
                    className="text-primary text-xs hover:underline"
                  >
                    Fix
                  </a>
                </div>
                <span className="text-error text-xs">
                  {row.reauthRequired
                    ? "Re-authentication required"
                    : row.permissionDenied
                      ? "Provider-side access lost (permission denied)"
                      : row.failingSince
                        ? `Sync failing since ${formatExactTimestamp(row.failingSince)}`
                        : row.lastSyncError
                          ? `Last sync failed: ${row.lastSyncError}`
                          : row.staleSince
                            ? `Data stale since ${formatExactTimestamp(row.staleSince)} (no recent successful sync)`
                            : "Data stale: no successful sync has completed yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SubSection>

      <SubSection
        icon={ShieldAlert}
        title="Failed alert deliveries"
        description="Every configured channel (Slack, email) has failed at least once for this alert"
        badge={
          failedAlerts.length > 0 && (
            <span className="bg-error/15 text-error rounded px-2 py-0.5 font-mono text-xs">
              {failedAlerts.length + failedAlertsOverflowCount}
            </span>
          )
        }
      >
        {failedAlerts.length === 0 ? (
          <p className="text-outline flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="text-tertiary size-3.5" />
            No alert deliveries are currently failing.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {failedAlerts.map((row) => (
              <li key={`${row.commitmentId}:${row.threshold}`} className="flex flex-col gap-0.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <a href={`/cases/${row.caseId}`} className="text-primary truncate hover:underline">
                    #{row.externalId} · {formatCommitmentKind(row.kind)} @ {row.threshold}%
                  </a>
                  <span className="text-outline shrink-0 font-mono text-xxs">
                    {row.attempts} attempt{row.attempts !== 1 ? "s" : ""} since{" "}
                    {formatExactTimestamp(row.firstFailedAt)}
                  </span>
                </div>
                <span className="text-error truncate text-xs">{row.error}</span>
              </li>
            ))}
            {failedAlertsOverflowCount > 0 && (
              <li className="text-outline text-xs">+{failedAlertsOverflowCount} more.</li>
            )}
          </ul>
        )}
      </SubSection>
    </div>
  );
}
