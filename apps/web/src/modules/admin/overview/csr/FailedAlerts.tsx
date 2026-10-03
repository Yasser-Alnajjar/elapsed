import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Tag } from "@/components/admin/admin-ui";
import {
  DataTableCard,
  DataTableFooter,
} from "@/components/shared/data-table/data-table-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUtcTimestamp, shortId } from "@/lib/admin-format";
import { formatCommitmentKind } from "@/lib/format";
import type { OperatorFailedAlertRow } from "@/lib/types/operator";

/**
 * Alerts no configured channel could deliver. Shows the ticket id, never its
 * subject: the operator needs to find the case, not read it. Each row links to
 * the tenant, because that case belongs to another organization and the
 * operator's own session cannot open it.
 */
export function FailedAlerts({
  rows,
  overflowCount,
}: {
  rows: OperatorFailedAlertRow[];
  overflowCount: number;
}) {
  return (
    <DataTableCard>
      <Table className="min-w-[820px]">
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Ticket</TableHead>
            <TableHead>Commitment</TableHead>
            <TableHead>Failure</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead align="end">
              <span className="sr-only">Action</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={`${row.commitmentId}:${row.threshold}`}
              className="[&>td]:align-top"
            >
              <TableCell>
                <p className="text-foreground text-sm font-semibold">
                  {row.organizationName ?? "Unnamed organization"}
                </p>
                <p
                  className="text-foreground-subtle font-mono text-[10px]"
                  title={row.organizationId}
                >
                  {shortId(row.organizationId)}
                </p>
              </TableCell>
              <TableCell nowrap>
                <span className="text-foreground font-mono text-sm font-semibold">
                  #{row.externalId}
                </span>
              </TableCell>
              <TableCell>
                <Tag tone="warning">
                  {formatCommitmentKind(row.kind)} @ {row.threshold}%
                </Tag>
              </TableCell>
              <TableCell>
                <p className="text-error max-w-md font-mono text-xs leading-5 break-words">
                  {row.error}
                </p>
                <p className="text-foreground-subtle mt-0.5 font-mono text-[10px]">
                  First failed {formatUtcTimestamp(row.firstFailedAt)}
                </p>
              </TableCell>
              <TableCell nowrap>
                <span className="bg-surface-raised text-foreground rounded px-2 py-1 font-mono text-xs font-semibold tabular-nums">
                  {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
                </span>
              </TableCell>
              <TableCell align="end" nowrap>
                <Link
                  href={`/admin/tenants/${row.organizationId}`}
                  className="text-primary hover:text-primary-hover inline-flex items-center gap-1.5 font-mono text-xs font-semibold"
                >
                  View tenant
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {overflowCount > 0 && (
        <DataTableFooter>+{overflowCount} more not shown.</DataTableFooter>
      )}
    </DataTableCard>
  );
}
