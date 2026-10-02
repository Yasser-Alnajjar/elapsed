import { ScanEye } from "lucide-react";
import Link from "next/link";
import { MonoLabel } from "@/components/admin/admin-ui";
import {
  formatUtcClock,
  formatUtcDate,
  formatUtcTimestamp,
  shortId,
} from "@/lib/admin-format";
import type { AdminAuditRow } from "@/lib/types/admin";
import { ActionBadge } from "./ActionBadge";
import { ChangeSummary } from "./ChangeSummary";

const COLUMNS = ["When (UTC)", "Operator", "Action", "Target", "Change", ""];

/** The read-only log. No edit or delete control exists here, or server-side. */
export function AuditTable({
  rows,
  onInspect,
}: {
  rows: AdminAuditRow[];
  onInspect: (row: AdminAuditRow) => void;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[960px] border-collapse text-left">
          <thead>
            <tr className="bg-surface-raised">
              {COLUMNS.map((column) => (
                <th
                  key={column || "inspect"}
                  scope="col"
                  className="px-3 py-2.5 first:pl-4 last:pr-4"
                >
                  {column ? (
                    <MonoLabel>{column}</MonoLabel>
                  ) : (
                    <span className="sr-only">Inspect</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-surface-raised/60 transition-colors"
              >
                <td className="py-3 pr-3 pl-4 align-top whitespace-nowrap">
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
                </td>
                <td className="px-3 py-3 align-top">
                  <span className="text-foreground font-mono text-xs break-all">
                    {row.actorEmail}
                  </span>
                </td>
                <td className="px-3 py-3 align-top">
                  <ActionBadge action={row.action} />
                </td>
                <td className="px-3 py-3 align-top">
                  <TargetCell row={row} />
                </td>
                <td className="max-w-md px-3 py-3 align-top">
                  <ChangeSummary row={row} />
                </td>
                <td className="py-3 pr-4 pl-3 text-right align-top">
                  <InspectButton row={row} onInspect={onInspect} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-border divide-y md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ActionBadge action={row.action} />
              <span className="text-foreground-subtle font-mono text-xxs tabular-nums">
                {formatUtcTimestamp(row.createdAt)}
              </span>
            </div>
            <span className="text-foreground font-mono text-xs break-all">
              {row.actorEmail}
            </span>
            <TargetCell row={row} />
            <ChangeSummary row={row} />
            <div>
              <InspectButton row={row} onInspect={onInspect} />
            </div>
          </li>
        ))}
      </ul>
    </>
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
    <button
      type="button"
      onClick={() => onInspect(row)}
      className="border-border text-muted-foreground hover:border-primary hover:text-primary inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-xxs font-semibold tracking-[0.04em] whitespace-nowrap uppercase transition-colors"
    >
      <ScanEye className="size-3.5" aria-hidden />
      Inspect
    </button>
  );
}
