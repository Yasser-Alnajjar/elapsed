import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Page title, ledger tag, and the full-CSV export button with the record count. */
export function CaseListHeader({
  totalCount,
  onExport,
}: {
  totalCount: number;
  onExport: () => void;
}) {
  return (
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
          Continuous SLA ledger across customer touches in your ticket source
          and engineering handoffs in your tracker
        </p>
      </div>

      <Button
        type="button"
        variant="surface"
        size="toolbar"
        onClick={onExport}
        className="group shrink-0 px-4 shadow-sm hover:bg-surface-bright"
      >
        <Download className="size-4.5 text-primary transition-transform group-hover:scale-110" />
        <span>Export Full CSV</span>

        <span className="rounded bg-surface-container-lowest px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">
          {totalCount} rec
        </span>
      </Button>
    </div>
  );
}
