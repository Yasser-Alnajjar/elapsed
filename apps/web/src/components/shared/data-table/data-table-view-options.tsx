"use client";

import { Columns3 } from "lucide-react";
import type { Table } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ColumnOption {
  id: string;
  label: string;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}

/**
 * The column picker, always in the toolbar's actions slot. It takes plain
 * options so a hand-built table (visible columns held in state) and a
 * TanStack table share it.
 */
export function DataTableColumnPicker({
  columns,
}: {
  columns: readonly ColumnOption[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Columns3 aria-hidden />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.visible}
            onCheckedChange={(checked) =>
              column.onVisibleChange(checked === true)
            }
            onSelect={(event) => event.preventDefault()}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The column picker for a TanStack table. */
export function DataTableViewOptions<TData>({
  table,
}: {
  table: Table<TData>;
}) {
  return (
    <DataTableColumnPicker
      columns={table
        .getAllColumns()
        .filter((column) => column.getCanHide())
        .map((column) => ({
          id: column.id,
          label: column.columnDef.meta?.name ?? column.id,
          visible: column.getIsVisible(),
          onVisibleChange: (visible) => column.toggleVisibility(visible),
        }))}
    />
  );
}
