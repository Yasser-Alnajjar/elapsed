import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { DataTableColumnHeader } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import type { CaseListRow } from "@/lib/types/cases";

import {
  CorrelationCell,
  CurrentStateAssigneeCell,
  CustomerSubjectCell,
  PriorityDualKeyCell,
  SlaTargetRunwayCell,
} from "./cells";

export const CASE_LIST_COLUMNS: ColumnDef<CaseListRow>[] = [
  {
    id: "priorityDualKey",
    meta: { name: "Priority & dual-key" },
    minSize: 170,
    accessorFn: (row) => row.externalId,
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Priority & dual-key"
      />
    ),
    cell: ({ row }) => <PriorityDualKeyCell row={row.original} />,
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    id: "subject",
    meta: { name: "Customer & subject" },
    minSize: 200,
    maxSize: 205,
    accessorFn: (row) => row.subject ?? row.customerName ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Customer & subject"
      />
    ),
    cell: ({ row }) => <CustomerSubjectCell row={row.original} />,
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    id: "correlation",
    meta: { name: "Correlation" },
    minSize: 120,
    maxSize: 140,
    accessorFn: (row) =>
      row.primaryLink ? row.primaryLink.confidence : "unlinked",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Correlation"
      />
    ),
    cell: ({ row }) => <CorrelationCell row={row.original} />,
    // No persisted, monotonic backing value once the list stops evaluating
    // live (link confidence is a to-many relation) — see SORT_COLUMNS in
    // case-list-data.ts.
    enableSorting: false,
    enableColumnFilter: false,
  },
  {
    id: "slaTargetRunway",
    meta: { name: "SLA target & runway" },
    minSize: 190,
    accessorFn: (row) =>
      row.liveCommitment?.remainingMinutes ?? row.worstCommitmentStatus ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="SLA target & runway"
      />
    ),
    cell: ({ row }) => <SlaTargetRunwayCell row={row.original} />,
    // Remaining minutes has no persisted, monotonic column to sort by.
    enableSorting: false,
    enableColumnFilter: false,
  },

  {
    id: "currentStateAssignee",
    meta: { name: "Current state & assignee" },
    minSize: 140,
    accessorFn: (row) => row.assigneeName ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Current state & assignee"
      />
    ),
    cell: ({ row }) => <CurrentStateAssigneeCell row={row.original} />,
    enableSorting: true,
    enableColumnFilter: false,
  },

  {
    id: "action",
    minSize: 100,
    meta: { align: "end" },
    header: () => <span className="sr-only">Action</span>,
    cell: ({ row }) => (
      <Button variant="subtle" size="sm" asChild>
        <Link href={`/cases/${row.original.caseId}`}>
          <span>View Case</span>
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    ),
    enableSorting: false,
    enableHiding: false,
    enableColumnFilter: false,
  },
];
