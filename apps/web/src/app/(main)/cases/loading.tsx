import { DataTableCard } from "@/components/shared/data-table/data-table-card";
import { DataTableSkeleton } from "@/components/shared/data-table/data-table-states";
import { Skeleton } from "@/components/ui/skeleton";

export default function CasesLoading() {
  return (
    <DataTableCard>
      <div className="flex items-center justify-between gap-4 border-b border-border p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-24" />
      </div>
      <DataTableSkeleton columns={5} rows={10} />
    </DataTableCard>
  );
}
