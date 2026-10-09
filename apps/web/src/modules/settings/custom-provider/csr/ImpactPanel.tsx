"use client";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UNSUPPORTED_KIND_COPY } from "@/lib/custom-provider/state-copy";
import type { ActivationImpact } from "@/lib/types/custom-provider";

const KIND_LABEL: Record<string, string> = { first_response: "First response", next_reply: "Next reply", resolution: "Resolution" };

/**
 * The dry-run shown before any existing commitment is cancelled (plan 09, 5.5).
 * Nothing has changed yet. Confirming repeats the activation bound to this exact
 * set; if anything changed in between, a new preview is required.
 */
export function ImpactPanel({ impact, busy, onConfirm, onCancel }: { impact: ActivationImpact; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancellation = impact.cancellation;
  return (
    <div className="border-warning/30 bg-warning/10 flex flex-col gap-3 rounded-lg border p-4 text-sm" role="alert">
      <p className="text-on-surface font-medium">This configuration makes some SLA targets unsupported for tickets Elapsed already tracks.</p>
      <ul className="text-on-surface-variant list-disc ps-5">
        {impact.newlyUnsupportedKinds.map((kind) => (
          <li key={kind}>{UNSUPPORTED_KIND_COPY[kind]}</li>
        ))}
      </ul>
      {cancellation && (
        <>
          <p className="text-on-surface">
            Activating will cancel <strong>{cancellation.total}</strong> unfinished commitment{cancellation.total === 1 ? "" : "s"}. Nothing is deleted, and {cancellation.keptFinalized} finished
            commitment{cancellation.keptFinalized === 1 ? "" : "s"} and every evaluation are kept exactly as they are.
          </p>
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead align="end">On track</TableHead>
                <TableHead align="end">At risk</TableHead>
                <TableHead align="end">Breached, still open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(cancellation.byKind).map(([kind, row]) => (
                <TableRow key={kind}>
                  <TableCell>{KIND_LABEL[kind] ?? kind}</TableCell>
                  <TableCell align="end">{row.onTrack}</TableCell>
                  <TableCell align="end">{row.atRisk}</TableCell>
                  <TableCell align="end">{row.breachedOpen}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-on-surface-variant text-xs">
            Cancelling is not undone by a rollback: a cancelled commitment is not restored when you switch back to an earlier configuration. Examples: {cancellation.sampleCaseIds.slice(0, 5).join(", ") || "none"}.
          </p>
        </>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>
          Confirm and activate
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
