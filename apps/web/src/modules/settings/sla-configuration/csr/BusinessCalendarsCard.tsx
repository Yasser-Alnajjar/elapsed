"use client";

import { Building, CalendarDays, Globe, Hourglass, Loader2, Plus, RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import type { BusinessCalendarOption } from "@/lib/types/sla-configuration";
import { CalendarEditorDialog } from "./CalendarEditorDialog";
import { InfoNote, SlaSection, tableHeadClass } from "./SlaSection";

const ROW_GRID = "grid grid-cols-1 items-center gap-2 px-4 py-3 lg:grid-cols-12";

function CalendarRow({
  calendar,
  isDefault,
  onSaved,
}: {
  calendar: BusinessCalendarOption;
  isDefault: boolean;
  onSaved: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

  async function handleSetDefault() {
    setSettingDefault(true);
    const { ok } = await Actions.SlaConfiguration.setDefaultCalendar(isDefault ? null : calendar.id);
    setSettingDefault(false);
    if (ok) onSaved();
  }

  const Icon = calendar.alwaysOpen ? Globe : calendar.source === "imported" ? RefreshCcw : Building;

  return (
    <>
      <div className={`${ROW_GRID} hover:bg-surface-container-high/50 transition-colors`}>
        <div className="flex min-w-0 items-center gap-2 lg:col-span-3">
          <Icon className={`size-4 shrink-0 ${calendar.alwaysOpen ? "text-secondary" : "text-outline"}`} />
          <span className="text-on-surface truncate text-sm font-semibold">{calendar.name}</span>
        </div>

        <div className="lg:col-span-2">
          <span
            className={`bg-surface-container-highest rounded px-2 py-0.5 font-mono text-xxs ${
              calendar.source === "imported" ? "text-secondary" : "text-primary"
            }`}
          >
            {calendar.source === "imported" ? "Imported" : "Native"}
          </span>
        </div>

        <div className="lg:col-span-2">
          {isDefault ? (
            <span className="bg-success/10 text-success rounded px-2 py-0.5 font-mono text-xxs font-semibold">
              ● Org default
            </span>
          ) : (
            <span className="text-outline font-mono text-xxs">Active</span>
          )}
        </div>

        <div className="text-on-surface-variant font-mono text-xs lg:col-span-3">
          {calendar.alwaysOpen ? "24/7 · All days" : calendar.timezone}
          <span className="text-outline block text-xxs">
            {calendar.holidays.length} holiday{calendar.holidays.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 lg:col-span-2 lg:justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={handleSetDefault} disabled={settingDefault}>
            {settingDefault && <Loader2 className="animate-spin" />}
            {isDefault ? "Unset default" : "Set as default"}
          </Button>
          <Button type="button" size="sm" variant="surface" onClick={() => setDialogOpen(true)}>
            Edit
          </Button>
        </div>
      </div>

      <CalendarEditorDialog
        mode="edit"
        calendar={calendar}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          setDialogOpen(false);
          onSaved();
        }}
      />
    </>
  );
}

export function BusinessCalendarsCard({
  calendars,
  defaultCalendarId,
}: {
  calendars: BusinessCalendarOption[];
  defaultCalendarId: string | null;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <SlaSection
      delay={0.05}
      icon={<CalendarDays className="size-5" />}
      title="Business Calendars"
      meta={`${calendars.length} active horizon${calendars.length === 1 ? "" : "s"}`}
      subtitle="Working hours, timezone, and holidays for imported (Zendesk) and native calendars"
      action={
        <Button type="button" size="sm" variant="surface" onClick={() => setCreateOpen(true)}>
          <Plus className="text-primary" />
          New calendar
        </Button>
      }
    >
      {calendars.length === 0 ? (
        <p className="text-on-surface-variant text-sm">No business calendars yet.</p>
      ) : (
        <div className="bg-surface-container overflow-hidden rounded-lg">
          <div className={`${tableHeadClass} bg-surface-container-lowest hidden grid-cols-12 gap-2 px-4 py-2.5 lg:grid`}>
            <div className="col-span-3">Calendar name</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-3">Timezone &amp; window</div>
            <div className="col-span-2 text-end">Actions</div>
          </div>
          <div className="divide-outline-variant/10 divide-y">
            {calendars.map((calendar) => (
              <CalendarRow
                key={calendar.id}
                calendar={calendar}
                isDefault={calendar.id === defaultCalendarId}
                onSaved={() => router.refresh()}
              />
            ))}
          </div>
        </div>
      )}

      <InfoNote icon={<Hourglass className="size-4" />}>
        Timers auto-pause during non-working hours and resume on the next tick. The org default is pre-selected when
        creating a native policy or calendar; it never overrides an existing customer calendar or a policy&apos;s own
        calendar. Editing an imported calendar&apos;s hours locally is never overwritten by the next Zendesk sync.
      </InfoNote>

      <CalendarEditorDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />
    </SlaSection>
  );
}
