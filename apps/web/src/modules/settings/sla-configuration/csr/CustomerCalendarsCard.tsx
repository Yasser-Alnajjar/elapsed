"use client";

import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tableHeadClass } from "./SlaSection";
import type { BusinessCalendarOption, CustomerCalendarSummary } from "@/lib/types/sla-configuration";

const DEFAULT_VALUE = "__default__";

function calendarLabel(calendar: BusinessCalendarOption): string {
  return calendar.alwaysOpen ? `${calendar.name} (24/7)` : `${calendar.name} — ${calendar.timezone}`;
}

function CustomerRow({ customer, calendars }: { customer: CustomerCalendarSummary; calendars: BusinessCalendarOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(customer.calendarId ?? DEFAULT_VALUE);
  const [saving, setSaving] = useState(false);

  const dirty = selected !== (customer.calendarId ?? DEFAULT_VALUE);

  async function handleSave() {
    setSaving(true);

    const { ok, body } = await Actions.SlaConfiguration.setCustomerCalendar(
      customer.id,
      selected === DEFAULT_VALUE ? null : selected,
    );
    setSaving(false);

    if (!ok) {
      notify.error(body.error ?? "Failed to save calendar.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="hover:bg-surface-container-high/50 space-y-2 px-3 py-2.5 transition-colors">
      <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
        <div className="flex min-w-0 items-center gap-2 sm:col-span-4">
          <Building2 className="text-outline size-4 shrink-0" />
          <p className="text-on-surface truncate text-sm font-medium">{customer.name}</p>
        </div>

        <div className="sm:col-span-3">
          {customer.tier && (
            <span className="bg-surface-container-highest text-primary rounded px-1.5 py-0.5 font-mono text-xxs uppercase">
              {customer.tier}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:col-span-5">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_VALUE}>Default (from matched policy)</SelectItem>
            {calendars.map((calendar) => (
              <SelectItem key={calendar.id} value={calendar.id}>
                {calendarLabel(calendar)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {dirty && (
          <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
        </div>
      </div>
    </div>
  );
}

/** Per-customer calendar override picker (roadmap step 24): assigns one of the org's existing `BusinessCalendar`s (an imported schedule, or the always-open default) to a customer, overriding whatever their matched SLA policy would otherwise resolve to. */
export function CustomerCalendarsCard({
  customers,
  calendars,
}: {
  customers: CustomerCalendarSummary[];
  calendars: BusinessCalendarOption[];
}) {
  if (customers.length === 0) {
    return <p className="text-sm text-on-surface-variant">No customers yet.</p>;
  }
  if (calendars.length === 0) {
    return (
      <p className="text-sm text-on-surface-variant">
        No business calendars available yet — import Zendesk business hours or SLA policies first.
      </p>
    );
  }

  return (
    <div className="bg-surface-container overflow-hidden rounded-lg">
      <div className={`${tableHeadClass} bg-surface-container-lowest hidden grid-cols-12 gap-2 px-3 py-2 sm:grid`}>
        <div className="col-span-4">Tenant / Customer</div>
        <div className="col-span-3">Tier</div>
        <div className="col-span-5">Pinned calendar</div>
      </div>
      <div className="divide-outline-variant/10 divide-y">
        {customers.map((customer) => (
          <CustomerRow key={customer.id} customer={customer} calendars={calendars} />
        ))}
      </div>
    </div>
  );
}
