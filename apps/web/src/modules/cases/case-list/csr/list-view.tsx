"use client";

import { ListChecks, Search } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Reveal } from "@/components/shared/reveal";

import type { CaseListData } from "@/lib/types/cases";

import { useCaseListColumns } from "./columns";
import { CaseListFilters } from "./filters";
import { CaseListMetrics } from "./metrics";
import { CaseListHeader } from "./CaseListHeader";
import { useCaseListQuery } from "./useCaseListQuery";

interface CaseListViewProps {
  data: CaseListData;
}

export const CaseListView = ({ data }: CaseListViewProps) => {
  const {
    searchDraft,
    setGlobalFilter,
    filters: { status, openState, linkState, severity },
    setStatus,
    setOpenState,
    setLinkState,
    setSeverity,
    hasActiveFilters,
    sorting,
    handleSortingChange,
    handleExport,
  } = useCaseListQuery();
  const columns = useCaseListColumns();

  const counts = data.counts;

  if (data.rowCount === 0 && !hasActiveFilters) {
    return (
      <Reveal delay={0}>
        <EmptyState
          icon={ListChecks}
          title="No cases yet"
          description="Cases will show up here once they start syncing in."
        />
      </Reveal>
    );
  }

  return (
    <div className="relative flex w-full flex-col gap-6">
      <Reveal delay={0}>
        <CaseListHeader
          totalCount={counts.status.all}
          onExport={handleExport}
        />
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
