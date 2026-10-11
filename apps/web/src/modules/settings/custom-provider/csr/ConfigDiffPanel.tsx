"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MAPPING_ERROR_COPY } from "@/lib/custom-provider/state-copy";
import type { ConfigDiff } from "@/lib/types/custom-provider";

const KIND_LABEL = { changed: "Changes", new: "New case", deleted: "Deleted", failing: "Would fail" } as const;

const FIELD_LABEL: Record<string, string> = {
  customer: "customer",
  subject: "title",
  assignee: "assignee",
  priority: "priority",
  channel: "channel",
  closedAt: "closing time",
  requester: "requester",
  tier: "tier",
  tags: "tags",
  attributes: "attributes",
};

const GUARD_COPY: Record<string, string> = {
  live_case_ceiling: "more live tickets than the configured limit for this source",
  mass_deletion: "too many existing cases would be deleted at once",
  mass_record_failure: "too many tickets would fail to import",
  mass_lifecycle_change: "too many existing cases would open or close at once",
};

const REIMPORT_COPY: Record<string, string> = {
  ticket_fields_not_stored: "The stored tickets do not contain every field this configuration reads.",
  comment_fields_not_stored: "The stored comments do not contain every field this configuration reads.",
  comments_source_changed: "Comments would come from a different place than the stored ones.",
  history_not_stored: "Status history this configuration reads is not stored for existing tickets.",
};

const eventLabel = (e: { type: string; occurredAt: string }) => `${e.type.replaceAll("_", " ")} ${e.occurredAt.slice(0, 16).replace("T", " ")}`;

/**
 * The dry-run diff of plan 09, 6.8: what a configuration would change in the
 * cases and events Elapsed already stores, computed from the stored snapshots
 * without writing anything. With `onConfirm`, activation is bound to exactly
 * this diff; if the stored data changes first, a new diff is shown.
 */
export function ConfigDiffPanel({ diff, busy, onConfirm, onCancel }: { diff: ConfigDiff; busy: boolean; onConfirm?: () => void; onCancel?: () => void }) {
  const s = diff.summary;
  if (diff.status === "no_stored_data") {
    return <Alert>Nothing is stored for this source yet, so there is nothing to compare. Every ticket will be imported as new.</Alert>;
  }
  return (
    <div className="border-outline-variant/30 bg-surface-container-low flex flex-col gap-3 rounded-lg border p-4 text-sm" role="region" aria-label="Changes to existing data">
      <p className="text-on-surface font-medium">What this configuration changes in data Elapsed already has</p>
      {diff.hash === null ? (
        <p className="text-on-surface-variant">No stored case or event would change ({s.ticketsCompared} tickets compared).</p>
      ) : (
        <p className="text-on-surface-variant">
          Of {s.ticketsCompared} stored tickets: {s.casesChanged} cases change, {s.casesNew} new, {s.casesDeleted} deleted, {s.casesFailing} would fail. Events: {s.eventsAdded} added, {s.eventsRemoved} removed.{" "}
          {s.lifecycleFlips > 0 ? `${s.lifecycleFlips} cases would open or close. ` : ""}
          {s.customersNew + s.customersRenamed > 0 ? `Customers: ${s.customersNew} new, ${s.customersRenamed} renamed.` : ""}
        </p>
      )}
      {diff.guard && (
        <Alert variant="destructive">
          The first sync with this configuration would stop before changing anything, because {GUARD_COPY[diff.guard] ?? diff.guard}. Review the mapping before activating.
        </Alert>
      )}
      {diff.reimport && (
        <Alert variant="warning">
          {diff.reimport.reasons.map((r) => REIMPORT_COPY[r] ?? r).join(" ")}
          {diff.reimport.missingPaths.length > 0 ? ` Not stored: ${diff.reimport.missingPaths.join(", ")}.` : ""} Elapsed re-reads a stored ticket only when it changes in your system, so until then the next sync
          derives it without those fields, as listed below. Reading all {diff.reimport.storedTickets} stored tickets again would take an estimated {diff.reimport.estimatedRuns} sync
          {diff.reimport.estimatedRuns === 1 ? "" : "s"}.
        </Alert>
      )}
      {diff.changes.length > 0 && (
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {diff.changes.map((c) => (
              <TableRow key={`${c.kind}:${c.externalId}`}>
                <TableCell className="align-top font-mono">
                  {c.externalId}
                  {c.subject ? <span className="text-on-surface-variant block font-sans">{c.subject}</span> : null}
                </TableCell>
                <TableCell className="align-top">{KIND_LABEL[c.kind]}</TableCell>
                <TableCell className="text-on-surface-variant align-top">
                  {c.kind === "failing" && (MAPPING_ERROR_COPY[c.failureCode ?? ""] ?? c.failureCode)}
                  {c.lifecycle && <span className="block">{c.lifecycle === "closes" ? "Would close." : "Would reopen."}</span>}
                  {c.fields.length > 0 && <span className="block">Changes {c.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}.</span>}
                  {c.eventsAdded.length > 0 && <span className="block">Adds {c.eventsAdded.map(eventLabel).join("; ")}.</span>}
                  {c.eventsRemoved.length > 0 && <span className="block">Removes {c.eventsRemoved.map(eventLabel).join("; ")}.</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {diff.truncated && <p className="text-on-surface-variant text-xs">Showing the first {diff.changes.length}; the counts above cover every ticket.</p>}
      {onConfirm && (
        <>
          <p className="text-on-surface-variant text-xs">Nothing has changed yet. Activating applies exactly these changes on the next sync; if the stored data changes first, you will see a new comparison.</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>
              Confirm and activate
            </Button>
            {onCancel && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
