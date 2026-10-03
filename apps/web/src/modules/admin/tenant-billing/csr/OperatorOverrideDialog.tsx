"use client";

import { CircleAlert, ShieldAlert } from "lucide-react";
import { useId, useState } from "react";
import { PLAN_IDS, PLANS, type PlanId } from "@sla/db/plans";
import { MonoLabel } from "@/components/admin/admin-ui";
import { useAdminOperator } from "@/components/admin/admin-operator-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/billing-format";
import type { AdminBillingActionInput } from "@/lib/billing-validation";
import type { AdminTenantBillingDetail } from "@/lib/types/admin-billing";
import type { OverrideRequest, OverrideResult } from "./TenantBillingView";

interface OperatorOverrideDialogProps {
  /** The override being made; null keeps the dialog closed. */
  request: OverrideRequest | null;
  data: AdminTenantBillingDetail;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: AdminBillingActionInput, success: string) => Promise<OverrideResult>;
}

const ACTIONS = {
  grant_grace: { title: "Grant 7-day grace", code: "GRANT_GRACE_EXTENSION_7_DAYS", done: "Grace extended by 7 days" },
  mark_paid: { title: "Record payment received", code: "MARK_INVOICE_PAID", done: "Payment recorded" },
  void_invoice: { title: "Void invoice", code: "VOID_INVOICE", done: "Invoice voided" },
  comp_open_invoices: { title: "Comp every open invoice", code: "COMP_OPEN_INVOICES", done: "Open invoices comped" },
  change_plan: { title: "Change plan tier", code: "CHANGE_PLAN_TIER", done: "Plan tier changed" },
  add_note: { title: "Update billing notes", code: "APPEND_OPERATOR_NOTE", done: "Operator note appended" },
} as const;

const MIN_RATIONALE = 10;

/** "Operator Override Notarization": the action, a mandatory rationale, and an explicit confirmation before it is signed. */
export function OperatorOverrideDialog({ request, data, busy, onOpenChange, onSubmit }: OperatorOverrideDialogProps) {
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      {request && (
        // Keyed so each opening starts with an empty form.
        <OverrideForm key={`${request.action}-${request.invoice?.id ?? ""}`} request={request} data={data} busy={busy} onCancel={() => onOpenChange(false)} onSubmit={onSubmit} />
      )}
    </Dialog>
  );
}

function OverrideForm({
  request,
  data,
  busy,
  onCancel,
  onSubmit,
}: {
  request: OverrideRequest;
  data: AdminTenantBillingDetail;
  busy: boolean;
  onCancel: () => void;
  onSubmit: OperatorOverrideDialogProps["onSubmit"];
}) {
  const actorEmail = useAdminOperator();
  const ids = { text: useId(), confirm: useId(), plan: useId() };
  const { action, invoice } = request;
  const spec = ACTIONS[action];
  const isNote = action === "add_note";
  const currentPlan = data.subscription?.plan ?? null;
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [plan, setPlan] = useState<PlanId>(currentPlan ?? "team");
  const [error, setError] = useState<string | null>(null);

  const textOk = isNote ? text.trim().length > 0 : text.trim().length >= MIN_RATIONALE;
  const valid = textOk && confirmed && (action !== "change_plan" || (plan !== currentPlan && data.subscription !== null));

  const input = (): AdminBillingActionInput | null => {
    const rationale = text.trim();
    switch (action) {
      case "add_note":
        return { action, note: rationale };
      case "change_plan":
        return data.subscription ? { action, plan, expectedVersion: data.subscription.version, rationale } : null;
      case "mark_paid":
      case "void_invoice":
        return invoice ? { action, invoiceId: invoice.id, rationale } : null;
      default:
        return { action, rationale };
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = input();
    if (!valid || !body) return;
    setError(null);
    const result = await onSubmit(body, action === "change_plan" ? `${spec.done}: ${PLANS[plan].name}` : spec.done);
    if (result.ok) onCancel();
    else setError(result.error ?? null);
  };

  return (
    <DialogContent>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-base">
            <ShieldAlert aria-hidden className="text-warning-text size-5" />
            Operator override notarization
          </DialogTitle>
          <DialogDescription>
            {spec.title}. Recorded with your {isNote ? "note" : "rationale"} as {actorEmail}.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-surface-raised rounded p-3">
          <MonoLabel className="mb-1 block">Target tenant</MonoLabel>
          <p className="text-foreground font-mono text-sm break-all">
            {data.tenant.id} ({data.tenant.name})
          </p>
          {invoice && (
            <p className="text-muted-foreground mt-1 font-mono text-xs">
              {invoice.number} · {formatMoney(invoice.amountCents, invoice.currency)}
            </p>
          )}
        </div>

        <div>
          <MonoLabel className="mb-1 block">Action type</MonoLabel>
          <p className="bg-surface-container text-foreground rounded p-2 font-mono text-xs">{spec.code}</p>
        </div>

        {action === "change_plan" && (
          <div>
            <label htmlFor={ids.plan}>
              <MonoLabel className="mb-1 block">New plan tier</MonoLabel>
            </label>
            <select
              id={ids.plan}
              value={plan}
              onChange={(event) => setPlan(event.target.value as PlanId)}
              className="bg-surface-container border-border text-foreground focus-visible:ring-primary h-9 w-full rounded border px-2 font-mono text-xs outline-none focus-visible:ring-1"
            >
              {PLAN_IDS.map((id) => (
                <option key={id} value={id}>
                  {PLANS[id].name}
                  {id === currentPlan ? " (current)" : ""}
                </option>
              ))}
            </select>
            <p className="text-foreground-subtle mt-1 font-mono text-[10px]">Applies immediately. Seats in use must fit the new plan.</p>
          </div>
        )}

        <div>
          <label htmlFor={ids.text}>
            <MonoLabel className="mb-1 block">{isNote ? "Note" : "Mandatory operator rationale"}</MonoLabel>
          </label>
          <Textarea
            id={ids.text}
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            placeholder={isNote ? "What the next operator should know about this account…" : "Why this override is needed (required for the audit log)…"}
            aria-describedby={`${ids.text}-hint`}
          />
          <p id={`${ids.text}-hint`} className="text-foreground-subtle mt-1 font-mono text-[10px]">
            {isNote ? "Up to 1,000 characters." : `At least ${MIN_RATIONALE} characters.`}
          </p>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox id={ids.confirm} checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} className="mt-0.5" />
          <label htmlFor={ids.confirm} className="text-foreground-subtle font-mono text-[10px] leading-4">
            I confirm this override follows the platform billing governance policy.
          </label>
        </div>

        {error && (
          <p role="alert" className="border-error/35 bg-error/10 text-error flex items-start gap-2 rounded-lg border p-3 text-sm">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="surface" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || busy} className="font-mono font-bold">
            {busy ? "Signing…" : "Sign & append to ledger"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
