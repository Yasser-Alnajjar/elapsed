import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AdminPanel, MonoLabel, Tag } from "@/components/admin/admin-ui";
import { formatUtcTimestamp, shortId } from "@/lib/admin-format";
import { formatCommitmentKind } from "@/lib/format";
import type { OperatorFailedAlertRow } from "@/lib/types/operator";

const COLUMNS = [
  "Organization",
  "Ticket",
  "Commitment",
  "Failure",
  "Attempts",
  "",
];

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
    <AdminPanel className="overflow-hidden">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="bg-surface-raised">
              {COLUMNS.map((column) => (
                <th
                  key={column || "action"}
                  scope="col"
                  className="px-3 py-2.5 first:pl-4 last:pr-4"
                >
                  {column ? (
                    <MonoLabel>{column}</MonoLabel>
                  ) : (
                    <span className="sr-only">Action</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((row) => (
              <tr
                key={`${row.commitmentId}:${row.threshold}`}
                className="hover:bg-surface-raised/60 transition-colors"
              >
                <td className="py-3 pr-3 pl-4 align-top">
                  <p className="text-foreground text-sm font-semibold">
                    {row.organizationName ?? "Unnamed organization"}
                  </p>
                  <p
                    className="text-foreground-subtle font-mono text-[10px]"
                    title={row.organizationId}
                  >
                    {shortId(row.organizationId)}
                  </p>
                </td>
                <td className="px-3 py-3 align-top">
                  <span className="text-foreground font-mono text-sm font-semibold">
                    #{row.externalId}
                  </span>
                </td>
                <td className="px-3 py-3 align-top">
                  <Tag tone="warning">
                    {formatCommitmentKind(row.kind)} @ {row.threshold}%
                  </Tag>
                </td>
                <td className="px-3 py-3 align-top">
                  <p className="text-error max-w-md font-mono text-xs leading-5 break-words">
                    {row.error}
                  </p>
                  <p className="text-foreground-subtle mt-0.5 font-mono text-[10px]">
                    First failed {formatUtcTimestamp(row.firstFailedAt)}
                  </p>
                </td>
                <td className="px-3 py-3 align-top">
                  <span className="bg-surface-raised text-foreground rounded px-2 py-1 font-mono text-xs font-semibold tabular-nums whitespace-nowrap">
                    {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
                  </span>
                </td>
                <td className="py-3 pr-4 pl-3 text-right align-top">
                  <Link
                    href={`/admin/tenants/${row.organizationId}`}
                    className="text-primary hover:text-primary-hover inline-flex items-center gap-1.5 font-mono text-xs font-semibold whitespace-nowrap"
                  >
                    View tenant
                    <ArrowRight className="size-3" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-border divide-y md:hidden">
        {rows.map((row) => (
          <li key={`${row.commitmentId}:${row.threshold}`}>
            <Link
              href={`/admin/tenants/${row.organizationId}`}
              className="hover:bg-surface-raised/60 flex flex-col gap-1.5 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground text-sm font-semibold">
                  {row.organizationName ?? "Unnamed organization"}
                </span>
                <span className="text-foreground-subtle font-mono text-xxs">
                  {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
                </span>
              </div>
              <span className="text-foreground-subtle font-mono text-xs">
                #{row.externalId} · {formatCommitmentKind(row.kind)} @{" "}
                {row.threshold}%
              </span>
              <span className="text-error font-mono text-xs break-words">
                {row.error}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {overflowCount > 0 && (
        <p className="border-border text-foreground-subtle border-t px-4 py-2.5 font-mono text-xxs">
          +{overflowCount} more not shown.
        </p>
      )}
    </AdminPanel>
  );
}
