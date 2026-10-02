import Link from "next/link";
import { Link2 } from "lucide-react";

import { formatExactTimestamp } from "@/lib/format";
import type { LinkCoveragePanel as LinkCoveragePanelData } from "@/lib/types/link-coverage";

const percent = (ratio: number) => Math.round(ratio * 100);

/**
 * N5.5: how much of the last 30 days of cases is linked to engineering work
 * with a `certain` link. A case without one has no engineering time measured,
 * so this says how much of the data that affects. Reported as measured:
 * `probable` links are listed apart and never counted, and the denominator is
 * every case opened, not an estimate of which ones "should" have escalated.
 */
export function LinkCoveragePanel({ coverage }: { coverage: LinkCoveragePanelData }) {
  const { cases, linkedCases, ratio, windowDays, probableOnlyCases, uncovered, uncoveredOverflowCount } = coverage;

  return (
    <div className="bg-surface-container-low shadow-soft flex flex-col gap-4 overflow-hidden rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Link2 className="text-outline mt-0.5 size-4" />
          <div>
            <h3 className="text-on-surface text-base font-medium">Engineering link coverage</h3>
            <p className="text-outline text-sm">
              Cases opened in the last {windowDays} days that are linked to engineering work
            </p>
          </div>
        </div>
        <span className="bg-surface-container-high text-on-surface rounded px-2 py-0.5 font-mono text-xs font-medium">
          {ratio === null ? "No cases yet" : `${percent(ratio)}%`}
        </span>
      </div>

      {ratio === null ? (
        <p className="text-outline text-sm">Coverage appears once cases have been opened in this window.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-on-surface text-sm">
              Linked <strong>{linkedCases.toLocaleString()}</strong> of <strong>{cases.toLocaleString()}</strong>{" "}
              cases ({percent(ratio)}%)
            </p>
            <div className="bg-surface-container-highest h-1.5 w-full overflow-hidden rounded-full">
              <div className="bg-tertiary h-full rounded-full" style={{ width: `${percent(ratio)}%` }} />
            </div>
            <p className="text-outline text-xs">
              Only certain links count. Not every case needs engineering, and an unlinked case simply has no
              engineering time measured.
              {probableOnlyCases > 0 &&
                ` ${probableOnlyCases.toLocaleString()} ${
                  probableOnlyCases === 1 ? "case has" : "cases have"
                } only a probable link, which is not counted.`}
            </p>
          </div>

          {uncovered.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-outline font-mono text-xxs font-semibold uppercase tracking-wider">
                Cases without a certain link
              </h4>
              <ul className="divide-surface-container-highest/40 divide-y text-sm">
                {uncovered.map((row) => (
                  <li key={row.caseId} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/cases/${row.caseId}`} className="text-primary font-mono text-xs hover:underline">
                        #{row.externalId}
                      </Link>{" "}
                      <span className="text-on-surface">{row.subject ?? "(no subject)"}</span>
                      <p className="text-outline truncate text-xs">
                        {row.customerName ?? "No customer"} · opened {formatExactTimestamp(row.openedAt)}
                        {row.hasProbableLink && " · probable link only"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/cases?linkState=unlinked" className="text-primary text-xs hover:underline">
                {uncoveredOverflowCount > 0
                  ? `+${uncoveredOverflowCount.toLocaleString()} more — see all unlinked cases`
                  : "See all unlinked cases"}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
