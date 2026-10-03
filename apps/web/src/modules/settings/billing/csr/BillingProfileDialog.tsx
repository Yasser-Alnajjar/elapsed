"use client";

import { Building2, CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BillingProfile } from "@/lib/types/billing";
import { useBillingActions } from "./billing-actions-context";

const splitList = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");

/** Edits who invoices are addressed and sent to. The server validates every field. */
export function BillingProfileDialog({ open, onOpenChange, profile }: { open: boolean; onOpenChange: (open: boolean) => void; profile: BillingProfile }) {
  const router = useRouter();
  const { notify } = useBillingActions();
  const ids = { email: useId(), name: useId(), address: useId(), country: useId(), tax: useId(), cc: useId() };
  const [form, setForm] = useState({
    billingEmail: profile.billingEmail ?? "",
    legalName: profile.legalName ?? "",
    address: profile.addressLines.join("\n"),
    country: profile.country ?? "",
    taxId: profile.taxId ?? "",
    cc: profile.ccEmails.join(", "),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await Actions.Billing.updateAccount({
        billingEmail: form.billingEmail,
        legalName: form.legalName,
        addressLines: form.address
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== ""),
        country: form.country,
        taxId: form.taxId,
        ccEmails: splitList(form.cc),
      });
      if (!result.ok) {
        setError(result.body.error ?? "The billing details could not be saved.");
        return;
      }
      notify("Billing details saved", "Future invoices use these details.", "success");
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const field = "flex flex-col gap-1.5";
  const label = "text-foreground text-sm font-medium";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Building2 aria-hidden className="text-primary size-5" />
              Billing details
            </DialogTitle>
            <DialogDescription>The legal entity, tax ID and recipients printed on and sent every invoice.</DialogDescription>
          </DialogHeader>

          <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
            <div className={`${field} sm:col-span-2`}>
              <label htmlFor={ids.name} className={label}>
                Legal entity name
              </label>
              <Input id={ids.name} value={form.legalName} onChange={set("legalName")} maxLength={200} autoComplete="organization" />
            </div>
            <div className={`${field} sm:col-span-2`}>
              <label htmlFor={ids.address} className={label}>
                Address <span className="text-foreground-subtle font-normal">(one line per row)</span>
              </label>
              <Textarea id={ids.address} value={form.address} onChange={set("address")} rows={3} autoComplete="street-address" />
            </div>
            <div className={field}>
              <label htmlFor={ids.country} className={label}>
                Jurisdiction
              </label>
              <Input id={ids.country} value={form.country} onChange={set("country")} maxLength={16} placeholder="US-CA" className="font-mono" />
            </div>
            <div className={field}>
              <label htmlFor={ids.tax} className={label}>
                Tax ID / EIN
              </label>
              <Input id={ids.tax} value={form.taxId} onChange={set("taxId")} maxLength={40} className="font-mono" />
            </div>
            <div className={`${field} sm:col-span-2`}>
              <label htmlFor={ids.email} className={label}>
                Primary billing email
              </label>
              <Input id={ids.email} type="email" value={form.billingEmail} onChange={set("billingEmail")} autoComplete="email" />
            </div>
            <div className={`${field} sm:col-span-2`}>
              <label htmlFor={ids.cc} className={label}>
                Also send invoices to <span className="text-foreground-subtle font-normal">(comma separated, up to 5)</span>
              </label>
              <Input id={ids.cc} value={form.cc} onChange={set("cc")} placeholder="finance@example.com" />
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="border-error/35 bg-error/10 text-error flex items-start gap-2 rounded-lg border p-3 text-sm">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="surface" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
