"use client";

import React, { useMemo } from "react";
import type { SortingState } from "@tanstack/react-table";

import { Download, ListChecks, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Reveal } from "@/components/shared/reveal";

import { Utils } from "@/lib/utils";
import { useQueryParams } from "@hooks";
import type { CaseListData, CaseListSortId } from "@/lib/types/cases";

import { useCaseListColumns } from "./columns";
import {
  type LinkFilter,
  type OpenFilter,
  type SeverityFilter,
  type StatusFilter,
} from "./constants";
import { CaseListFilters } from "./filters";
import { CaseListMetrics } from "./metrics";

interface CaseListViewProps {
  data: CaseListData;
}

/** Every case-list filter/sort/search resets pagination to page 1. */
function withPageReset(patch: Record<string, string | number | undefined>) {
  return { ...patch, page: 1 };
}

export const CaseListView = ({ data }: CaseListViewProps) => {
  const { getQueryObject, createQueryFromObject } = useQueryParams();
  const query = getQueryObject();

  const globalFilter = String(query.q ?? "");
  const status = (query.status as StatusFilter) ?? "all";
  const openState = (query.openState as OpenFilter) ?? "all";
  const linkState = (query.linkState as LinkFilter) ?? "all";
  const severity = (query.severity as SeverityFilter) ?? "all";

  const sorting: SortingState = query.sort
    ? [{ id: String(query.sort), desc: query.dir !== "asc" }]
    : [];

  const columns = useCaseListColumns();

  const searchTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchDraft, setSearchDraft] = React.useState(globalFilter);
  React.useEffect(() => setSearchDraft(globalFilter), [globalFilter]);

  const setGlobalFilter = (value: string) => {
    setSearchDraft(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      createQueryFromObject(withPageReset({ q: value || undefined }));
    }, 300);
  };

  const setStatus = (value: StatusFilter) =>
    createQueryFromObject(withPageReset({ status: value === "all" ? undefined : value }));
  const setOpenState = (value: OpenFilter) =>
    createQueryFromObject(withPageReset({ openState: value === "all" ? undefined : value }));
  const setLinkState = (value: LinkFilter) =>
    createQueryFromObject(withPageReset({ linkState: value === "all" ? undefined : value }));
  const setSeverity = (value: SeverityFilter) =>
    createQueryFromObject(withPageReset({ severity: value === "all" ? undefined : value }));

  const handleSortingChange = (next: SortingState) => {
    const first = next[0];
    createQueryFromObject({
      sort: first ? (first.id as CaseListSortId) : undefined,
      dir: first ? (first.desc ? "desc" : "asc") : undefined,
    });
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (openState !== "all") params.set("openState", openState);
    if (linkState !== "all") params.set("linkState", linkState);
    if (severity !== "all") params.set("severity", severity);
    if (globalFilter) params.set("q", globalFilter);
    window.open(`/api/cases/export?${params.toString()}`, "_blank");
  };

  const counts = data.counts;

  if (data.rowCount === 0 && !globalFilter && status === "all" && openState === "all" && linkState === "all" && severity === "all") {
    return (
      <EmptyState
        icon={ListChecks}
        title="No cases yet"
        description="Cases will show up here once they start syncing in."
      />
    );
  }

  return (
    <div className="relative flex w-full flex-col gap-6">
      <Reveal delay={0}>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-4xl font-semibold tracking-tight text-on-surface">
                Cases
              </h1>

              <span className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-xxs font-semibold tracking-wider uppercase text-primary">
                Operational Ledger
              </span>

              <span className="size-1.5 animate-pulse rounded-full bg-tertiary" />
            </div>

            <p className="text-sm text-on-surface-variant">
              Continuous SLA ledger across Zendesk customer touches and Jira
              engineering handoffs
            </p>
          </div>

          <Button
            type="button"
            variant="surface"
            size="toolbar"
            onClick={handleExport}
            className="group shrink-0 px-4 shadow-sm hover:bg-surface-bright"
          >
            <Download className="size-4.5 text-primary transition-transform group-hover:scale-110" />
            <span>Export Full CSV</span>

            <span className="rounded bg-surface-container-lowest px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">
              {counts.status.all} rec
            </span>
          </Button>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <CaseListMetrics
          total={counts.status.all}
          open={counts.open.open}
          runningClock={counts.runningClock}
          linkedCertain={counts.linkedCertain}
          linked={counts.link.linked}
        />
      </Reveal>

      <Reveal delay={0.1}>
        <CaseListFilters
          globalFilter={searchDraft}
          setGlobalFilter={setGlobalFilter}
          status={status}
          setStatus={setStatus}
          openState={openState}
          setOpenState={setOpenState}
          linkState={linkState}
          setLinkState={setLinkState}
          severity={severity}
          setSeverity={setSeverity}
          statusCounts={counts.status}
          openCounts={counts.open}
          linkCounts={counts.link}
          severityCounts={counts.severity}
        />
      </Reveal>

      <Reveal delay={0.15}>
        <div className="overflow-hidden rounded bg-surface-container-low shadow-md">
          <DataTable
            title="Cases"
            className="p-0 lg:p-0"
            headerClassName="border-0 bg-surface-container-lowest font-mono text-xxs font-semibold tracking-wider text-outline hover:bg-surface-container-lowest"
            headCellClassName="h-auto whitespace-normal align-middle px-2.5 py-3 text-inherit font-[inherit] tracking-[inherit] first:ps-4 last:pe-4"
            cellClassName="px-2.5 py-3 align-top first:ps-4 last:pe-4"
            rowClassName="border-0 hover:bg-surface-container-high odd:bg-surface-container-low even:bg-surface-container"
            columns={columns}
            data={data.cases}
            manual
            pageCount={data.pageCount}
            rowCount={data.rowCount}
            sorting={sorting}
            onSortingChange={handleSortingChange}
            empty={
              <EmptyState
                icon={Search}
                title="No cases match these filters"
                description="Try clearing the SLA status, case status, or search filters."
              />
            }
          />
        </div>
      </Reveal>
    </div>
  );
};
