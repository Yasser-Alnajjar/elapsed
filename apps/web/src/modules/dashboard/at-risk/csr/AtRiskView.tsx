"use client";

import { ListChecks, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  DataTableCard,
  DataTableEmpty,
  DataTablePagination,
  useUrlTableState,
} from "@/components/shared/data-table";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { cn, Utils } from "@/lib/utils";
import type { AtRiskPageData } from "@/lib/types/at-risk";

import { AtRiskCard } from "./AtRiskCard";
import { AtRiskToolbar } from "./AtRiskFilters";
import type { LegFilter, SeverityFilter } from "./types";
import { AtRiskHeader } from "./AtRiskHeader";
import { AtRiskKpiGrid } from "./AtRiskKpiGrid";
import Link from "next/link";

/** Only the first this-many cards get the staggered entrance animation — a full page of 50 replaying `Reveal` on every server refresh is what the plan calls out (performance-plan.md Phase 2 item 4). */
const REVEAL_LIMIT = 10;

export const AtRiskView = ({ data }: { data: AtRiskPageData }) => {
  const router = useRouter();
  const url = useUrlTableState();

  // `severity` and `q` are server-side (persisted `Case.priority` / a
  // search filter on persisted case fields) — changing either re-fetches a
  // fresh, still-bounded page. `leg` is derived from live evaluation with no
  // persisted equivalent, so it only narrows the rows already on this page.
  const severity = (url.query.severity as SeverityFilter) ?? "all";
  const [leg, setLeg] = useState<LegFilter>("all");

  const hasActiveFilters =
    severity !== "all" || leg !== "all" || url.search !== "";
  const resetFilters = () => {
    setLeg("all");
    url.reset(["severity"]);
  };

  const legCounts = useMemo(
    () => ({
      all: data.rows.length,
      support: data.rows.filter((row) => row.currentLeg === "support").length,
      engineering: data.rows.filter((row) => row.currentLeg === "engineering")
        .length,
      waiting_customer: data.rows.filter(
        (row) => row.currentLeg === "waiting_customer",
      ).length,
      unknown: data.rows.filter((row) => row.currentLeg === "unknown").length,
    }),
    [data.rows],
  );

  const filtered = useMemo(
    () =>
      leg === "all"
        ? data.rows
        : data.rows.filter((row) => row.currentLeg === leg),
    [data.rows, leg],
  );

  return (
    <>
      <Reveal delay={0}>
        <AtRiskHeader
          totalCount={data.totalCount}
          linkedCertainCount={data.linkedCertainCount}
          onExport={() => Utils.exportToCsv("at-risk-page.csv", filtered)}
          onRefresh={() => router.refresh()}
        />
      </Reveal>

      <AtRiskKpiGrid data={data} />

      <Reveal delay={0.15} className="mt-4">
        <DataTableCard>
          <AtRiskToolbar
            severity={severity}
            leg={leg}
            query={url.search}
            severityCounts={data.counts.severity}
            legCounts={legCounts}
            onSeverityChange={(value) => url.setFilter("severity", value)}
            onLegChange={setLeg}
            onQueryChange={url.setSearch}
            onReset={hasActiveFilters ? resetFilters : undefined}
          />

          <div
            aria-busy={url.pending || undefined}
            className={cn(
              "flex flex-col gap-3 p-3 transition-opacity sm:p-4",
              url.pending && "opacity-60",
            )}
          >
            {data.totalCount === 0 ? (
              <DataTableEmpty
                icon={ListChecks}
                title="No open commitments"
                description="Everything currently tracked is closed."
              />
            ) : filtered.length === 0 ? (
              <DataTableEmpty
                icon={Search}
                title="No commitments match these filters"
                description="Try clearing the severity, locus, or search filters."
                action={
                  hasActiveFilters && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={resetFilters}
                    >
                      Reset filters
                    </Button>
                  )
                }
              />
            ) : (
              filtered.map((row, index) =>
                index < REVEAL_LIMIT ? (
                  <Reveal
                    key={row.commitmentId}
                    delay={Math.min(0.02 * index, 0.3)}
                  >
                    <AtRiskCard row={row} />
                  </Reveal>
                ) : (
                  <AtRiskCard key={row.commitmentId} row={row} />
                ),
              )
            )}
          </div>

          <DataTablePagination
            page={data.page}
            pageSize={data.pageSize}
            pageCount={data.pageCount}
            rowCount={data.rowCount}
            itemLabel="open commitments"
            onPageChange={url.setPage}
            onPageSizeChange={url.setPageSize}
            pending={url.pending}
          />
        </DataTableCard>
      </Reveal>

      {data.totalCount > 0 && (
        <Reveal delay={0.2} className="mt-4">
          <section className="p-4 mt-1 rounded bg-surface-container-lowest flex flex-col md:flex-row items-start md:items-center justify-between gap-1 flex-wrap">
            <div className="flex items-start gap-2.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-md text-on-surface font-semibold">
                  Why does this SLA number say what it says?
                </span>
                <p className="text-sm text-on-surface-variant max-w-4xl">
                  Calculations are strictly continuous and deterministic.
                  Elapsed ingests raw immutable timestamp events from Zendesk
                  tickets and Jira webhooks. Transit between queues does{" "}
                  <strong>NOT pause</strong> the SLA clock. Pauses are applied
                  solely if explicitly contracted scheduled maintenance windows
                  are active.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <span className="font-mono text-xs text-outline">
                Engine: RFC-822 / UTC Strict
              </span>

              <Link
                href="/settings/sla/configuration"
                className="px-1 py-1 rounded bg-surface-container hover:bg-surface-container-high text-primary text-sm transition-colors"
              >
                View Clock Audit Schema
              </Link>
            </div>
          </section>
        </Reveal>
      )}
    </>
  );
};
