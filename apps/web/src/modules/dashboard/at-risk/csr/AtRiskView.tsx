"use client";

import { ListChecks, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { Reveal } from "@/components/shared/reveal";
import { Utils } from "@/lib/utils";
import type { AtRiskPageData } from "@/lib/types/at-risk";
import { useQueryParams } from "@hooks";

import { AtRiskCard } from "./AtRiskCard";
import { AtRiskFilters } from "./AtRiskFilters";
import { AtRiskPagination } from "./AtRiskPagination";
import type { LegFilter, SeverityFilter } from "./types";
import { AtRiskHeader } from "./AtRiskHeader";
import { AtRiskKpiGrid } from "./AtRiskKpiGrid";
import Link from "next/link";

/** Only the first this-many cards get the staggered entrance animation — a full page of 50 replaying `Reveal` on every server refresh is what the plan calls out (performance-plan.md Phase 2 item 4). */
const REVEAL_LIMIT = 10;

export const AtRiskView = ({ data }: { data: AtRiskPageData }) => {
  const router = useRouter();
  const { getQueryObject, createQueryFromObject } = useQueryParams();
  const query = getQueryObject();

  // `severity` and `q` are server-side (persisted `Case.priority` / a
  // search filter on persisted case fields) — changing either re-fetches a
  // fresh, still-bounded page. `leg` is derived from live evaluation with no
  // persisted equivalent, so it only narrows the rows already on this page.
  const severity = (query.severity as SeverityFilter) ?? "all";
  const [leg, setLeg] = useState<LegFilter>("all");

  const searchDraft0 = String(query.q ?? "");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchDraft, setSearchDraft] = useState(searchDraft0);
  useEffect(() => setSearchDraft(searchDraft0), [searchDraft0]);

  const setQuery = (value: string) => {
    setSearchDraft(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      createQueryFromObject({ q: value || undefined, page: 1 });
    }, 300);
  };

  const setSeverity = (value: SeverityFilter) =>
    createQueryFromObject({
      severity: value === "all" ? undefined : value,
      page: 1,
    });

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
        <AtRiskFilters
          severity={severity}
          leg={leg}
          query={searchDraft}
          severityCounts={data.counts.severity}
          legCounts={legCounts}
          onSeverityChange={setSeverity}
          onLegChange={setLeg}
          onQueryChange={setQuery}
          pageSize={data.pageSize}
        />
      </Reveal>

      <div className="mt-4 flex flex-col gap-3">
        {data.totalCount === 0 ? (
          <Reveal delay={0.2}>
            <EmptyState
              icon={ListChecks}
              title="No open commitments"
              description="Everything currently tracked is closed."
            />
          </Reveal>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No commitments match these filters"
            description="Try clearing the severity, locus, or search filters."
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

      {data.rowCount > 0 && (
        <div className="mt-4">
          <AtRiskPagination
            page={data.page}
            pageSize={data.pageSize}
            pageCount={data.pageCount}
            rowCount={data.rowCount}
          />
        </div>
      )}

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
