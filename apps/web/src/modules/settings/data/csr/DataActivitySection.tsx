import { History } from "lucide-react";

import {
  DataTableCard,
  DataTableEmpty,
  DataTableEmptyRow,
} from "@/components/shared/data-table";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLongDateTime } from "@/lib/format";
import { TONE_SURFACE, type Tone } from "@/lib/status-styles";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import type { DataOperationRow } from "@/lib/types/data";
import { cn } from "@/lib/utils";
import { describeOperation, exportFormat, isExportFormat } from "@/lib/data-export/formats";
import { formatCount } from "./data-format";

const STATUS: Record<DataOperationRow["status"], { label: string; tone: Tone }> = {
  started: { label: "In progress", tone: "primary" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

/** The audit trail: who backed up or cleaned up which integration's data, and when. */
export function DataActivitySection({ operations }: { operations: DataOperationRow[] }) {
  return (
    <section className="space-y-3">
      <SettingsSectionHeader
        eyebrow="Audit"
        title="Activity"
        description="Every backup, export and cleanup, with who ran it. The most recent 20 are shown."
      />

      <DataTableCard>
        <Table className="min-w-[48rem]">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Integration</TableHead>
              <TableHead>By</TableHead>
              <TableHead align="end">Records</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {operations.length === 0 && (
              <DataTableEmptyRow colSpan={7}>
                <DataTableEmpty icon={History} title="No exports or cleanups yet" />
              </DataTableEmptyRow>
            )}

            {operations.map((operation) => {
              const status = STATUS[operation.status];
              return (
                <TableRow key={operation.id}>
                  <TableCell nowrap className="text-on-surface-variant font-mono text-xs">
                    {formatLongDateTime(operation.startedAt)}
                  </TableCell>
                  <TableCell className="text-on-surface text-sm">{describeOperation(operation.kind, operation.format)}</TableCell>
                  <TableCell className="text-on-surface-variant font-mono text-xs">
                    {operation.format && isExportFormat(operation.format) ? exportFormat(operation.format).short : "—"}
                  </TableCell>
                  <TableCell className="text-on-surface text-sm">
                    {INTEGRATION_PROVIDER_LABELS[operation.provider]}
                  </TableCell>
                  <TableCell truncate title={operation.actorEmail} className="text-on-surface-variant font-mono text-xs">
                    {operation.actorEmail}
                  </TableCell>
                  <TableCell align="end" nowrap className="text-on-surface font-mono text-xs">
                    {operation.records === null ? "—" : formatCount(operation.records)}
                  </TableCell>
                  <TableCell>
                    <span
                      title={operation.error ?? undefined}
                      className={cn(
                        "inline-flex rounded border px-2 py-0.5 font-mono text-xxs font-semibold uppercase",
                        TONE_SURFACE[status.tone],
                      )}
                    >
                      {status.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTableCard>
    </section>
  );
}
