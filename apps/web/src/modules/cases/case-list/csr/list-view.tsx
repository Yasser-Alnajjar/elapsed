"use client";

import React, { useMemo, useState } from "react";

import { Download, ListChecks, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Reveal } from "@/components/shared/reveal";

import { formatPriorityTier } from "@/lib/format";
import { Utils } from "@/lib/utils";
import type { CaseListData } from "@/lib/types/cases";

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

export const CaseListView = ({ data }: CaseListViewProps) => {
  const [globalFilter, setGlobalFilter] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openState, setOpenState] = useState<OpenFilter>("all");
  const [linkState, setLinkState] = useState<LinkFilter>("all");
  const [severity, setSeverity] = useState<SeverityFilter>("all");

  const columns = useCaseListColumns();

  const openCases = useMemo(
    () => data.cases.filter((caseItem) => !caseItem.closedAt),
    [data.cases],
  );

  const breachedCases = useMemo(
    () =>
      data.cases.filter(
        (caseItem) => caseItem.worstCommitmentStatus === "breached",
      ),
    [data.cases],
  );

  const atRiskCases = useMemo(
    () =>
      data.cases.filter(
        (caseItem) => caseItem.worstCommitmentStatus === "at_risk",
      ),
    [data.cases],
  );

  const linkedCases = useMemo(
    () => data.cases.filter((caseItem) => caseItem.primaryLink !== null),
    [data.cases],
  );

  const linkedCertainCases = useMemo(
    () =>
      data.cases.filter(
        (caseItem) => caseItem.primaryLink?.confidence === "certain",
      ),
    [data.cases],
  );

  const runningClockCases = useMemo(
    () => data.cases.filter((caseItem) => caseItem.liveCommitment !== null),
    [data.cases],
  );

  const statusCounts = useMemo(
    () => ({
      all: data.cases.length,
      breached: breachedCases.length,
      at_risk: atRiskCases.length,
      on_track: data.cases.filter(
        (caseItem) => caseItem.worstCommitmentStatus === "on_track",
      ).length,
      met: data.cases.filter(
        (caseItem) => caseItem.worstCommitmentStatus === "met",
      ).length,
    }),
    [data.cases, breachedCases.length, atRiskCases.length],
  );

  const openCounts = useMemo(
    () => ({
      all: data.cases.length,
      open: openCases.length,
      closed: data.cases.length - openCases.length,
    }),
    [data.cases, openCases.length],
  );

  const linkCounts = useMemo(
    () => ({
      all: data.cases.length,
      linked: linkedCases.length,
      unlinked: data.cases.length - linkedCases.length,
    }),
    [data.cases, linkedCases.length],
  );
  const severityCounts = useMemo(
    () => ({
      all: data.cases.length,
      P1: data.cases.filter(
        (caseItem) => formatPriorityTier(caseItem.priority) === "P1",
      ).length,
      P2: data.cases.filter(
        (caseItem) => formatPriorityTier(caseItem.priority) === "P2",
      ).length,
      P3: data.cases.filter(
        (caseItem) => formatPriorityTier(caseItem.priority) === "P3",
      ).length,
      P4: data.cases.filter(
        (caseItem) => formatPriorityTier(caseItem.priority) === "P4",
      ).length,
    }),
    [data.cases],
  );
  const filtered = useMemo(() => {
    const search = globalFilter.trim().toLowerCase();

    return data.cases.filter((caseItem) => {
      if (search) {
        const searchableText = JSON.stringify(caseItem).toLowerCase();

        if (!searchableText.includes(search)) {
          return false;
        }
      }

      if (status !== "all" && caseItem.worstCommitmentStatus !== status) {
        return false;
      }

      if (openState === "open" && caseItem.closedAt) {
        return false;
      }

      if (openState === "closed" && !caseItem.closedAt) {
        return false;
      }

      if (linkState === "linked" && !caseItem.primaryLink) {
        return false;
      }

      if (linkState === "unlinked" && caseItem.primaryLink) {
        return false;
      }

      if (
        severity !== "all" &&
        formatPriorityTier(caseItem.priority) !== severity
      ) {
        return false;
      }

      return true;
    });
  }, [data.cases, globalFilter, status, openState, linkState, severity]);
  if (data.cases.length === 0) {
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
            onClick={() => Utils.exportToCsv("all-cases.csv", data.cases)}
            className="group shrink-0 px-4 shadow-sm hover:bg-surface-bright"
          >
            <Download className="size-4.5 text-primary transition-transform group-hover:scale-110" />
            <span>Export Full CSV</span>

            <span className="rounded bg-surface-container-lowest px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">
              {data.cases.length} rec
            </span>
          </Button>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <CaseListMetrics
          total={data.cases.length}
          open={openCases.length}
          runningClock={runningClockCases.length}
          linkedCertain={linkedCertainCases.length}
          linked={linkedCases.length}
        />
      </Reveal>

      <Reveal delay={0.1}>
        <CaseListFilters
          globalFilter={globalFilter}
          setGlobalFilter={setGlobalFilter}
          status={status}
          setStatus={setStatus}
          openState={openState}
          setOpenState={setOpenState}
          linkState={linkState}
          setLinkState={setLinkState}
          severity={severity}
          setSeverity={setSeverity}
          statusCounts={statusCounts}
          openCounts={openCounts}
          linkCounts={linkCounts}
          severityCounts={severityCounts}
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
            data={filtered}
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
