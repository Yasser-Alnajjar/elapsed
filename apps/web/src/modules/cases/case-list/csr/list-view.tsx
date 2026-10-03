"use client";

import { ListChecks, Search } from "lucide-react";
import { DataTable, DataTableEmpty } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";

import type { CaseListData } from "@/lib/types/cases";

import { CASE_LIST_COLUMNS } from "./columns";
import { CaseListToolbar } from "./filters";
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
    resetFilters,
    sorting,
    handleSortingChange,
    handleExport,
    setPage,
    setPageSize,
    pending,
  } = useCaseListQuery();
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
          linked={counts.link.linked}
          linkedCertain={counts.linkedCertain}
        />
      </Reveal>

      <Reveal delay={0.1}>
        <DataTable
          rowClassName="[&>td]:align-top"
          columns={CASE_LIST_COLUMNS}
          data={data.cases}
          reorderable
          resizable
          loading={pending}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          toolbar={({ table }) => (
            <CaseListToolbar
              table={table}
              search={searchDraft}
              onSearchChange={setGlobalFilter}
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
              onReset={hasActiveFilters ? resetFilters : undefined}
            />
          )}
          pagination={{
            page: data.page,
            pageSize: data.pageSize,
            pageCount: data.pageCount,
            rowCount: data.rowCount,
            itemLabel: "cases",
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
          }}
          empty={
            <DataTableEmpty
              icon={Search}
              title="No cases match these filters"
              description="Try clearing the SLA status, case status, or search filters."
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
          }
        />
      </Reveal>
    </div>
  );
};
