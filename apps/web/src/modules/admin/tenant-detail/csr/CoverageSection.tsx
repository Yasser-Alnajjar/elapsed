import { ScanSearch, TriangleAlert } from "lucide-react";
import { AdminPanel, Fact, MonoLabel, SectionTitle, StatusDot } from "@/components/admin/admin-ui";
import { formatUtcTimestamp } from "@/lib/admin-format";
import { LINK_COVERAGE_FLAG_RATIO, type AdminSlaImportSummary, type AdminTenantRow } from "@/lib/types/admin";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import { cn } from "@/lib/utils";

interface CoverageSectionProps {
  tenant: AdminTenantRow;
  casesWithNoMatchingPolicy: number;
  slaImport: AdminSlaImportSummary | null;
}

/** How much of this tenant's work is covered: by a tracker link, and by an SLA policy. */
export function CoverageSection({ tenant, casesWithNoMatchingPolicy, slaImport }: CoverageSectionProps) {
  const { linkCoverage } = tenant;
  const percent = linkCoverage.ratio === null ? null : Math.round(linkCoverage.ratio * 100);
  const flagged = linkCoverage.ratio !== null && linkCoverage.ratio < LINK_COVERAGE_FLAG_RATIO;
  const unlinked = linkCoverage.cases - linkCoverage.linkedCases;

  return (
    <section aria-labelledby="coverage" className="flex flex-col gap-3">
      <SectionTitle
        icon={ScanSearch}
        title={<span id="coverage">Link coverage & policy import</span>}
        description="How much of this tenant's work is traceable to an engineering tracker, and covered by an SLA policy."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <AdminPanel className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <MonoLabel>Tracker link coverage (30 days)</MonoLabel>
            {flagged && (
              <span className="border-warning/35 bg-warning/10 text-warning-text flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em] uppercase">
                <TriangleAlert className="size-3" aria-hidden />
                Below {Math.round(LINK_COVERAGE_FLAG_RATIO * 100)}%
              </span>
            )}
          </div>

          <div className="flex items-end gap-3">
            <span className={cn("font-mono text-5xl leading-none font-bold tabular-nums", flagged ? "text-warning-text" : "text-foreground")}>
              {percent === null ? "—" : `${percent}%`}
            </span>
            <span className="text-muted-foreground pb-1 text-sm">
              {linkCoverage.cases === 0 ? "No cases opened in the last 30 days." : `${linkCoverage.linkedCases} of ${linkCoverage.cases} recent cases linked`}
            </span>
          </div>

          {percent !== null && (
            <div className="bg-surface-hover h-1.5 w-full overflow-hidden rounded-full">
              <div className={cn("h-full rounded-full", flagged ? "bg-warning" : "bg-primary")} style={{ width: `${percent}%` }} />
            </div>
          )}

          {flagged && unlinked > 0 && (
            <p className="border-warning/30 bg-warning/[0.07] text-muted-foreground rounded border px-3.5 py-2.5 text-sm leading-5">
              <span className="text-warning-text font-semibold">
                {unlinked} recent case{unlinked === 1 ? "" : "s"}
              </span>{" "}
              {unlinked === 1 ? "has" : "have"} no confirmed link to an engineering issue, so the engineering leg of {unlinked === 1 ? "its" : "their"} clock cannot be measured.
            </p>
          )}

          <dl className="border-border grid grid-cols-3 gap-4 border-t pt-3">
            <Fact label="Open cases" mono>
              {tenant.openCases}
            </Fact>
            <Fact label="Evaluations (24 h)" mono>
              {tenant.evaluations24h}
            </Fact>
            <Fact label="No matching policy" mono tone={casesWithNoMatchingPolicy > 0 ? "warning" : undefined}>
              {casesWithNoMatchingPolicy}
            </Fact>
          </dl>
        </AdminPanel>

        <AdminPanel className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <MonoLabel>
              Policy import{slaImport?.provider ? ` (${INTEGRATION_PROVIDER_LABELS[slaImport.provider]})` : ""}
            </MonoLabel>
            {slaImport && <span className="text-foreground-subtle font-mono text-[10px]">as of {formatUtcTimestamp(slaImport.updatedAt)}</span>}
          </div>

          {slaImport ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <ImportCount label="Unsupported metrics" value={slaImport.unsupportedMetrics} />
              <ImportCount label="Unsupported conditions" value={slaImport.unsupportedConditions} />
              <ImportCount label="No usable target" value={slaImport.policiesWithNoUsableTargets} />
              <ImportCount label="Unresolved schedule" value={slaImport.policiesWithUnresolvedSchedule} />
              <ImportCount label="Policies archived" value={slaImport.policiesArchived} neutral />
              <ImportCount label="Cases with no policy" value={slaImport.casesWithNoMatchingPolicy} />
            </dl>
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <StatusDot tone="neutral" />
              No policy import has run for this organization.
            </p>
          )}
        </AdminPanel>
      </div>
    </section>
  );
}

function ImportCount({ label, value, neutral = false }: { label: string; value: number; neutral?: boolean }) {
  return (
    <div className="bg-background/60 border-border flex flex-col gap-1 rounded border px-3 py-2.5">
      <dt>
        <MonoLabel>{label}</MonoLabel>
      </dt>
      <dd className={cn("font-mono text-xl font-bold tabular-nums", value > 0 && !neutral ? "text-warning-text" : "text-foreground")}>{value}</dd>
    </div>
  );
}
