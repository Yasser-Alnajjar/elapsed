"use client";

import type { Dispatch, SetStateAction } from "react";
import { MultiCombobox } from "@/components/shared/multi-combobox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  BusinessCalendarOption,
  CustomerCalendarSummary,
} from "@/lib/types/sla-configuration";
import {
  calendarLabel,
  PRIORITIES,
  USE_ORGANIZATION_DEFAULT,
  type PolicyFormState,
} from "./native-policy-form";

const PRIORITY_OPTIONS = PRIORITIES.map((priority) => ({
  value: priority,
  label: priority.charAt(0).toUpperCase() + priority.slice(1),
}));

/** Which cases the policy applies to (priority, tier, customers) and the calendar its clock runs on. */
export function PolicyMatchingFields({
  state,
  onChange,
  disabled,
  businessCalendars,
  customers,
  defaultCalendarId,
}: {
  state: PolicyFormState;
  onChange: Dispatch<SetStateAction<PolicyFormState>>;
  disabled: boolean;
  businessCalendars: BusinessCalendarOption[];
  customers: CustomerCalendarSummary[];
  defaultCalendarId: string | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Matching</h3>
        <p className="text-xs text-on-surface-variant">
          Define which cases this policy should apply to.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Priority */}
        <div className="space-y-2">
          <Label>Priority</Label>

          <MultiCombobox
            options={PRIORITY_OPTIONS}
            selected={[...state.priorities]}
            onChange={(selected) =>
              onChange((s) => ({
                ...s,
                priorities: new Set(selected),
              }))
            }
            placeholder="Select priorities..."
            searchPlaceholder="Search priorities..."
            emptyText="No priorities found."
            allSelectedText="All priorities selected."
            disabled={disabled}
          />

          <p className="text-xs text-on-surface-variant">
            Leave empty to match any priority.
          </p>
        </div>

        {/* Tier */}
        <div className="space-y-2">
          <Label>Tier</Label>

          <Select disabled>
            <SelectTrigger>
              <SelectValue placeholder="No data source yet" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="none">No data source yet</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Customer */}
        {customers.length > 0 && (
          <div className="space-y-2">
            <Label>Customers</Label>

            <MultiCombobox
              options={customers.map((customer) => ({
                value: customer.id,
                label: customer.name,
              }))}
              selected={[...state.customerIds]}
              onChange={(selected) =>
                onChange((s) => ({
                  ...s,
                  customerIds: new Set(selected),
                }))
              }
              placeholder="Select customers..."
              searchPlaceholder="Search customers..."
              emptyText="No customers found."
              allSelectedText="All customers selected."
              disabled={disabled}
            />

            <p className="text-xs text-on-surface-variant">
              Leave empty to match any customer.
            </p>
          </div>
        )}

        {/* Calendar */}
        <div className="space-y-2">
          <Label>Calendar</Label>

          <Select
            value={state.calendarId}
            onValueChange={(value) =>
              onChange((s) => ({
                ...s,
                calendarId: value,
              }))
            }
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select calendar" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value={USE_ORGANIZATION_DEFAULT}>
                {defaultCalendarId
                  ? `Organization default (${businessCalendars.find((c) => c.id === defaultCalendarId)?.name ?? "unnamed"})`
                  : "Organization default (none set — falls back to Always open)"}
              </SelectItem>
              {businessCalendars.map((calendar) => (
                <SelectItem key={calendar.id} value={calendar.id}>
                  {calendarLabel(calendar)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-on-surface-variant">
            {state.calendarId === USE_ORGANIZATION_DEFAULT
              ? "New commitments always use whichever calendar is currently the organization default (Settings → Business calendars), not a fixed snapshot."
              : "Pinned to this calendar — new commitments use it until this policy is edited to point elsewhere."}
          </p>
        </div>
      </div>
    </div>
  );
}
