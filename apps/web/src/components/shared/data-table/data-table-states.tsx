import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * What a table shows when it has no rows: one treatment for "nothing yet" and
 * "nothing matches these filters" (the caller picks the words and, for the
 * latter, passes a reset `action`). Sits inside the table card, so no border.
 */
export function DataTableEmpty({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <EmptyState
      bordered={false}
      icon={icon}
      title={title}
      description={description}
      action={action}
      className={cn("py-14", className)}
    />
  );
}

/** The empty state as a table row, for tables whose header should stay visible. */
export function DataTableEmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0">
        {children}
      </TableCell>
    </TableRow>
  );
}

/** The loading placeholder: the same header and row geometry as a real table, so nothing jumps when data arrives. Server-safe. */
export function DataTableSkeleton({
  columns = 5,
  rows = 8,
  className,
}: {
  columns?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <Table scroll={false} className={className} aria-hidden>
      <TableHeader>
        <TableRow>
          {Array.from({ length: columns }, (_, column) => (
            <TableHead key={column}>
              <Skeleton className="h-3 w-16" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, row) => (
          <TableRow key={row} className="hover:bg-transparent">
            {Array.from({ length: columns }, (_, column) => (
              <TableCell key={column}>
                <Skeleton
                  className={cn("h-4", column === 0 ? "w-28" : "w-full max-w-32")}
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
