"use client";

import { Database } from "lucide-react";
import Link from "next/link";

import {
  DataTableCard,
  DataTableEmpty,
  DataTableEmptyRow,
  DataTableFooter,
  DataTableRangeSummary,
} from "@/components/shared/data-table";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLongDateTime } from "@/lib/format";
import { TONE_DOT, TONE_SURFACE } from "@/lib/status-styles";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import type { IntegrationDataRow } from "@/lib/types/data";
import { cn } from "@/lib/utils";
import { ExportDataButton } from "./ExportDataButton";
import { CleanupDataButton } from "./CleanupDataButton";
import { CONNECTION_STATUS, formatCount } from "./data-format";

/** Integrations that hold stored data — connected or not — with their data breakdown and the backup / cleanup actions. */
export function IntegrationDataSection({
  integrations,
  canManage,
}: {
  integrations: IntegrationDataRow[];
  canManage: boolean;
}) {
  return (
    <section className="space-y-3">
      <SettingsSectionHeader
        eyebrow="Integrations"
        title="Integration data"
        description="What each integration has stored. Disconnecting never deletes this — a disconnected integration stays here until you clean it up."
      />

      <DataTableCard>
        <Table className="min-w-[60rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Integration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="end">Records</TableHead>
              <TableHead>Breakdown</TableHead>
              <TableHead>Last sync</TableHead>
              <TableHead align="end">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {integrations.length === 0 && (
              <DataTableEmptyRow colSpan={6}>
                <DataTableEmpty
                  icon={Database}
                  title="No integration data stored"
                  description="Data appears here once an integration has imported records."
                  action={
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/settings/integrations">Go to Integrations</Link>
                    </Button>
                  }
                />
              </DataTableEmptyRow>
            )}

            {integrations.map((row) => {
              const label = INTEGRATION_PROVIDER_LABELS[row.provider];
              const status = CONNECTION_STATUS[row.status];
              const disconnected = row.status === "disconnected";
              const { counts } = row;

              return (
                <TableRow key={row.integrationId}>
                  <TableCell>
                    <Link
                      href={`/settings/integrations/${row.provider}`}
                      className="text-on-surface text-sm font-medium hover:underline"
                    >
                      {label}
                    </Link>
                  </TableCell>

                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xxs font-semibold uppercase",
                        TONE_SURFACE[status.tone],
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", TONE_DOT[status.tone])} />
                      {status.label}
                    </span>
                  </TableCell>

                  <TableCell align="end" nowrap className="text-on-surface font-mono text-sm font-semibold">
                    {formatCount(row.total)}
                  </TableCell>

                  <TableCell className="text-on-surface-variant font-mono text-xs">
                    <span className="grid min-w-64 grid-cols-3 gap-x-4 gap-y-0.5 whitespace-nowrap">
                      <span>Cases {formatCount(counts.cases)}</span>
                      <span>Events {formatCount(counts.normalizedEvents)}</span>
                      <span>Commitments {formatCount(counts.commitments)}</span>
                      <span>Raw {formatCount(counts.rawEvents)}</span>
                      <span>
                        Other{" "}
                        {formatCount(
                          counts.evaluations + counts.caseLinks + counts.customerIdentities + counts.other,
                        )}
                      </span>
                    </span>
                  </TableCell>

                  <TableCell nowrap className="text-on-surface-variant font-mono text-xs">
                    {row.lastSyncAt ? formatLongDateTime(row.lastSyncAt) : "Never"}
                    {disconnected && row.disconnectedAt && (
                      <span className="block text-xxs text-outline">
                        Disconnected {formatLongDateTime(row.disconnectedAt)}
                      </span>
                    )}
                  </TableCell>

                  <TableCell align="end">
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <ExportDataButton
                        provider={row.provider}
                        providerLabel={label}
                        counts={counts}
                        disabled={!canManage}
                      />
                      <CleanupDataButton
                        provider={row.provider}
                        providerLabel={label}
                        counts={counts}
                        disabled={!canManage || !disconnected}
                        disabledReason={
                          !canManage
                            ? "Only an organization owner can clean up data."
                            : !disconnected
                              ? `Disconnect ${label} first to clean up its data.`
                              : undefined
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <DataTableFooter>
          <DataTableRangeSummary
            shown={integrations.length}
            total={integrations.length}
            label="integrations with stored data"
          />
        </DataTableFooter>
      </DataTableCard>
    </section>
  );
}
