import { Award, Info, NotebookPen, ShieldUser, StickyNote } from "lucide-react";
import { AdminPanel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { formatBillingDateTime, formatMoney } from "@/lib/billing-format";
import type { OperatorNote } from "@/lib/types/admin-billing";

interface OverrideSafeguardsPanelProps {
  notes: OperatorNote[];
  openCents: number;
  busy: boolean;
  onUpdateNotes: () => void;
  onComp: () => void;
}

/** "Admin Billing Override & Operational Safeguards": notes and comping, and the latest operator note. */
export function OverrideSafeguardsPanel({ notes, openCents, busy, onUpdateNotes, onComp }: OverrideSafeguardsPanelProps) {
  const latest = notes[0];
  return (
    <AdminPanel id="overrides" aria-labelledby="overrides-title" className="flex scroll-mt-20 flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div className="max-w-2xl">
          <h2 id="overrides-title" className="text-foreground mb-1 flex items-center gap-2 text-lg font-bold">
            <ShieldUser aria-hidden className="text-tertiary size-5" />
            Admin Billing Override &amp; Operational Safeguards
          </h2>
          <p className="text-foreground-subtle mb-3 text-sm">
            Billing overrides never change how SLAs are measured. Every change is appended to the billing history and the platform audit log with the
            operator&apos;s rationale.
          </p>
          <p className="text-warning-text bg-warning/10 flex items-start gap-2 rounded p-2 font-mono text-[10px] leading-4">
            <Info aria-hidden className="size-4 shrink-0" />
            Operator must supply mandatory justification for grace extensions, recorded payments and comped invoices.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row lg:items-center">
          <Button type="button" variant="surface" disabled={busy} onClick={onUpdateNotes} className="font-mono text-xs font-semibold">
            <NotebookPen aria-hidden className="text-primary" />
            Update billing notes
          </Button>
          <Button
            type="button"
            variant="surface"
            disabled={busy || openCents === 0}
            title={openCents === 0 ? "Nothing is open to comp." : undefined}
            onClick={onComp}
            className="text-tertiary font-mono text-xs font-semibold"
          >
            <Award aria-hidden />
            Comp open invoices{openCents > 0 && ` (${formatMoney(openCents)})`}
          </Button>
        </div>
      </div>

      <div className="bg-surface-raised/40 flex flex-col justify-between gap-2 rounded-lg p-3 md:flex-row md:items-center">
        <div className="flex items-start gap-3">
          <StickyNote aria-hidden className="text-foreground-subtle mt-0.5 size-4.5 shrink-0" />
          {latest ? (
            <div className="flex flex-col">
              <span className="text-foreground-subtle font-mono text-[10px] uppercase">
                Latest operator note ({formatBillingDateTime(latest.at)} by {latest.author}):
              </span>
              <span className="text-foreground text-sm">&ldquo;{latest.text}&rdquo;</span>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">No operator notes on this tenant yet.</span>
          )}
        </div>
        {notes.length > 1 && <span className="text-foreground-subtle shrink-0 font-mono text-[10px]">{notes.length} notes in the lifecycle stream</span>}
      </div>
    </AdminPanel>
  );
}
