"use client";

import { AlertCircle, CheckCircle2, Info, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonoLabel } from "@/components/admin/admin-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BILLING_REFERENCE_MAX_LENGTH,
  PLAN_IDS,
  PLAN_LABELS,
  PLAN_STATUSES,
  PLAN_STATUS_LABELS,
  type PlanRecord,
  type PlanStatus,
} from "@/lib/types/admin";

interface PlanRecordFormProps {
  organizationId: string;
  record: PlanRecord;
}

/** Radix `Select` cannot hold an empty value, so "no plan recorded" is a sentinel. */
const NO_PLAN = "__none__";

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** Form controls in the console's look: dark field, mono value, primary border on focus. */
const FIELD = "bg-background border-border text-foreground focus-visible:border-primary h-9 rounded font-mono text-xs";

/**
 * Edits one organization's manual plan record (N4.3). The record is
 * informational: nothing in the worker or the app reads it to decide what to
 * monitor or alert on. Plan names are the live pricing page's (D14); the price
 * hints are the page's list prices, not a billing source.
 */
export function PlanRecordForm({ organizationId, record }: PlanRecordFormProps) {
  const router = useRouter();
  const [plan, setPlan] = useState(record.plan ?? NO_PLAN);
  const [planStatus, setPlanStatus] = useState<PlanStatus>(record.planStatus);
  const [trialEndsAt, setTrialEndsAt] = useState(toDateInput(record.trialEndsAt));
  const [billingReference, setBillingReference] = useState(record.billingReference ?? "");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const next: PlanRecord = {
    plan: plan === NO_PLAN ? null : plan,
    planStatus,
    trialEndsAt: trialEndsAt ? new Date(trialEndsAt).toISOString() : null,
    billingReference: billingReference.trim() === "" ? null : billingReference.trim(),
  };
  const dirty = JSON.stringify(next) !== JSON.stringify(record);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setResult(null);

    const { ok, body } = await AdminClientActions.updatePlanRecord(organizationId, next);

    setSaving(false);
    if (!ok) {
      setResult({ ok: false, message: body.error ?? "Failed to save the plan record" });
      return;
    }
    setResult({ ok: true, message: body.changed ? "Plan record saved and audited." : "No changes." });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
      <p className="bg-surface-raised border-border text-muted-foreground flex items-start gap-2.5 rounded border px-3.5 py-3 text-sm leading-5">
        <Info className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="text-foreground font-semibold">Informational only.</span> This record never changes how this organization is monitored, alerted or limited.
        </span>
      </p>

      <Field id="plan" label="Plan" hint="Starter $49 · Team $149 · Enterprise custom, seat-based.">
        <Select value={plan} onValueChange={setPlan} disabled={saving}>
          <SelectTrigger id="plan" className={`${FIELD} w-full`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PLAN}>Not recorded</SelectItem>
            {PLAN_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                {PLAN_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id="plan-status" label="Status">
        <Select value={planStatus} onValueChange={(value) => setPlanStatus(value as PlanStatus)} disabled={saving}>
          <SelectTrigger id="plan-status" className={`${FIELD} w-full`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAN_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {PLAN_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id="trial-ends-at" label="Trial ends">
        <Input id="trial-ends-at" type="date" value={trialEndsAt} onChange={(event) => setTrialEndsAt(event.target.value)} disabled={saving} className={FIELD} />
      </Field>

      <Field id="billing-reference" label="Billing reference">
        <Input
          id="billing-reference"
          value={billingReference}
          onChange={(event) => setBillingReference(event.target.value)}
          placeholder="Invoice or contract id"
          maxLength={BILLING_REFERENCE_MAX_LENGTH}
          disabled={saving}
          className={FIELD}
        />
      </Field>

      {result && (
        <Alert variant={result.ok ? "success" : "destructive"}>
          {result.ok ? <CheckCircle2 /> : <AlertCircle />}
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={!dirty || saving} className="font-mono text-xs">
        {saving ? <Loader2 className="animate-spin" /> : <Save />}
        {saving ? "Saving…" : "Save plan record"}
      </Button>
      <p className="text-foreground-subtle -mt-2 text-center font-mono text-[10px]">Saving is recorded in the audit log as update_plan.</p>
    </form>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id}>
        <MonoLabel>{label}</MonoLabel>
      </label>
      {children}
      {hint && <p className="text-foreground-subtle font-mono text-[10px]">{hint}</p>}
    </div>
  );
}
