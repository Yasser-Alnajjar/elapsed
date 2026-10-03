import { ScanEye } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatUtcClock,
  formatUtcDate,
  formatUtcTimestamp,
  shortId,
} from "@/lib/admin-format";
import type { AdminAuditRow } from "@/lib/types/admin";
import { ActionBadge } from "./ActionBadge";
import { ChangeSummary } from "./ChangeSummary";

/** The read-only log. No edit or delete control exists here, or server-side. */
export function AuditTable({
  rows,
  onInspect,
}: {
  rows: AdminAuditRow[];
  onInspect: (row: AdminAuditRow) => void;
}) {
  return (
    <Table className="min-w-[960px]">
      <TableHeader>
        <TableRow>
          <TableHead>When (UTC)</TableHead>
          <TableHead>Operator</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Change</TableHead>
          <TableHead align="end">
            <span className="sr-only">Inspect</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="[&>td]:align-top">
            <TableCell nowrap>
              <p
                className="text-foreground font-mono text-xs tabular-nums"
                title={formatUtcTimestamp(row.createdAt)}
              >
                {formatUtcDate(row.createdAt)},{" "}
                {formatUtcClock(new Date(row.createdAt))}
              </p>
              <p
                className="text-foreground-subtle font-mono text-[10px]"
                title={row.id}
              >
                id {shortId(row.id)}
              </p>
            </TableCell>
            <TableCell>
              <span className="text-foreground font-mono text-xs break-all">
                {row.actorEmail}
              </span>
            </TableCell>
            <TableCell>
              <ActionBadge action={row.action} />
            </TableCell>
            <TableCell>
              <TargetCell row={row} />
            </TableCell>
            <TableCell className="max-w-md">
              <ChangeSummary row={row} />
            </TableCell>
            <TableCell align="end">
              <InspectButton row={row} onInspect={onInspect} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TargetCell({ row }: { row: AdminAuditRow }) {
  if (!row.organizationId) {
    return (
      <span className="text-foreground-subtle font-mono text-xs">Platform</span>
    );
  }
  if (!row.organizationName) {
    return (
      <span
        className="text-foreground-subtle font-mono text-xs"
        title={row.organizationId}
      >
        Deleted organization
      </span>
    );
  }
  return (
    <div className="flex flex-col">
      <Link
        href={`/admin/tenants/${row.organizationId}`}
        className="text-primary text-sm font-medium hover:underline"
      >
        {row.organizationName}
      </Link>
      <span
        className="text-foreground-subtle font-mono text-[10px]"
        title={row.organizationId}
      >
        {shortId(row.organizationId)}
      </span>
    </div>
  );
}

function InspectButton({
  row,
  onInspect,
}: {
  row: AdminAuditRow;
  onInspect: (row: AdminAuditRow) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => onInspect(row)}
    >
      <ScanEye aria-hidden />
      Inspect
    </Button>
  );
}
