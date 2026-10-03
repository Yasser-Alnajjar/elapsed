import { formatExactTimestamp } from "@/lib/format";
import type { AttributionLedger } from "@/lib/types/dashboard";
import { LEG_STYLES } from "@/lib/status-styles";

/** The "30-Day Attribution Ledger": period-scoped leg-hour totals and linking precision. */
export function AttributionLedgerCard({
  ledger,
  engineeringMeasured = true,
}: {
  ledger: AttributionLedger;
  /** False without a tracker: engineering hours are "not measured", never a zero (N5.2). */
  engineeringMeasured?: boolean;
}) {
  const rows = [
    {
      label: "Total support leg hours",
      value: ledger.supportLegHours,
      dot: LEG_STYLES.support.fill,
      valueClassName: "text-on-surface",
    },
    {
      label: "Total engineering leg hours",
      value: engineeringMeasured ? ledger.engineeringLegHours : null,
      dot: LEG_STYLES.engineering.fill,
      valueClassName: LEG_STYLES.engineering.text,
    },
    {
      label: "Waiting on customer/vendor",
      value: ledger.waitingCustomerLegHours,
      dot: LEG_STYLES.waiting_customer.fill,
      valueClassName: "text-outline",
    },
  ];

  return (
    <div className="bg-surface-container-low shadow-soft flex flex-col justify-between rounded-xl p-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-on-surface text-base font-medium">
            30-Day Attribution Ledger
          </h3>
          <span className="bg-tertiary size-2 rounded-full" aria-hidden />
        </div>
        <p className="text-outline mb-4 text-sm">
          Deterministic correlation breakdown for time spent by department
        </p>
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.label}
              className="bg-surface-container flex items-center justify-between rounded p-2"
            >
              <div className="flex items-center gap-2">
                <span className={`size-2.5 rounded-sm ${row.dot}`} />
                <span className="text-on-surface text-sm">{row.label}</span>
              </div>
              <span className={`font-mono text-sm font-semibold ${row.valueClassName}`}>
                {row.value === null
                  ? "—"
                  : `${row.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`}
              </span>
            </div>
          ))}
        </div>

        <div className="bg-surface-container-lowest/80 mt-4 flex flex-col gap-2 rounded p-2">
          <div className="text-outline flex items-center justify-between font-mono text-xxs font-semibold uppercase tracking-wider">
            <span>Linking precision</span>
            <span className="text-tertiary">
              {!engineeringMeasured
                ? "Needs a tracker"
                : ledger.linkingPrecisionPercent !== null
                  ? `${ledger.linkingPrecisionPercent}% certain`
                  : "No tracked cases yet"}
            </span>
          </div>
          <div className="bg-surface-container-highest h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-tertiary h-full rounded-full"
              style={{ width: `${ledger.linkingPrecisionPercent ?? 0}%` }}
            />
          </div>
          {engineeringMeasured ? (
            <div className="text-outline flex items-center justify-between font-mono text-xxs">
              <span>{ledger.directMatches} direct ID matches</span>
              <span>{ledger.unlinkedOrStandalone} unlinked / standalone</span>
            </div>
          ) : (
            <p className="text-outline font-mono text-xxs">
              Engineering time appears once a tracker is connected.
            </p>
          )}
        </div>
      </div>
      <div className="border-surface-container-highest/60 text-outline mt-4 flex items-center justify-between border-t pt-2 font-mono text-xs">
        <span className="flex items-center gap-1">
          <span className="text-tertiary">✓</span> Audit timestamped
        </span>
        <span className="text-on-surface-variant">
          {formatExactTimestamp(ledger.auditTimestamp)}
        </span>
      </div>
    </div>
  );
}
