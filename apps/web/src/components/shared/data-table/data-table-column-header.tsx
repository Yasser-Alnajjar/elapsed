import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, EyeOff } from "lucide-react";

import { DataTableColumnFilter } from "./data-table-column-filter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@components/ui/dropdown-menu";

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const canSort = column.columnDef.enableSorting ?? false;
  const canFilter = column.columnDef.enableColumnFilter ?? false;

  if (!canSort && !canFilter) {
    return <div className={cn("flex items-center", className)}>{title}</div>;
  }

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      {canSort ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 h-8 data-[state=open]:bg-accent text-foreground font-medium focus-visible:ring-0 focus-visible:ring-offset-0"
            >
              <span>{title}</span>
              {column.getIsSorted() === "desc" ? (
                <ArrowDown className="ms-2 h-4 w-4" />
              ) : column.getIsSorted() === "asc" ? (
                <ArrowUp className="ms-2 h-4 w-4" />
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-32">
            <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
              <ArrowUp className="me-2 h-3.5 w-3.5 text-muted-foreground/70" />
              Asc
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
              <ArrowDown className="me-2 h-3.5 w-3.5 text-muted-foreground/70" />
              Desc
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
              <EyeOff className="me-2 h-3.5 w-3.5 text-muted-foreground/70" />
              Hide
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className={cn("font-medium text-sm", className)}>{title}</span>
      )}

      {canFilter && <DataTableColumnFilter column={column} title={title} />}
    </div>
  );
}
