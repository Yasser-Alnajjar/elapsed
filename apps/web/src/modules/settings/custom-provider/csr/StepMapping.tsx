"use client";

import { getIn } from "@/lib/custom-provider/wizard";
import { MapEditor, SelectField, TextField } from "./fields";
import type { StepProps } from "./wizard-types";

const STATES = [
  { value: "new", label: "New" },
  { value: "open", label: "Open" },
  { value: "pending_customer", label: "Waiting on customer" },
  { value: "pending_internal", label: "Waiting internally" },
  { value: "in_progress", label: "In progress" },
  { value: "escalated", label: "Escalated" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const FIELDS: { key: string; label: string; required?: boolean; hint?: string }[] = [
  { key: "id", label: "Ticket ID", required: true, hint: "Stable and unique." },
  { key: "createdAt", label: "Created at", required: true, hint: "ISO 8601 with an offset, or add a time zone below." },
  { key: "status", label: "Status", required: true },
  { key: "title", label: "Title" },
  { key: "priority", label: "Priority" },
  { key: "customerId", label: "Customer ID" },
  { key: "customerName", label: "Customer name" },
  { key: "closedAt", label: "Closed / resolved at", hint: "Needed to track resolution: Elapsed never guesses a closing time from 'updated at'." },
  { key: "tags", label: "Tags (a list)" },
  { key: "channel", label: "Channel" },
];

/** Step 3: which field of a ticket means what. Only mapped fields are stored. */
export function StepMapping({ config, set, paths }: StepProps) {
  const mappingOf = (key: string) => {
    const value = getIn(config, ["mapping", key]);
    return typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  };
  const statusMap = (getIn(config, ["valueMaps", "status"]) ?? {}) as Record<string, string>;
  const priorityMap = (getIn(config, ["valueMaps", "priority"]) ?? {}) as Record<string, string>;
  return (
    <div className="flex flex-col gap-6">
      <datalist id="cp-paths">
        {paths.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      {paths.length === 0 && <p className="text-on-surface-variant text-xs">Run “Sample” in the Review step to see your ticket fields here and pick paths from a list.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <TextField
            key={field.key}
            id={`cp-map-${field.key}`}
            label={`${field.label}${field.required ? " *" : ""}`}
            mono
            list="cp-paths"
            value={mappingOf(field.key)}
            onChange={(v) => {
              let parsed: unknown = v;
              if (v.trim().startsWith("{")) {
                try {
                  parsed = JSON.parse(v);
                } catch {
                  parsed = v;
                }
              }
              set(["mapping", field.key], parsed);
            }}
            placeholder="$.field"
            hint={field.hint}
          />
        ))}
        <TextField
          id="cp-tz"
          label="Time zone for dates without an offset"
          value={String(config.timezone ?? "")}
          onChange={(v) => set(["timezone"], v === "" ? undefined : v)}
          placeholder="Europe/London"
          hint="An IANA name. Never assumed: a date with no offset and no time zone fails the ticket. Clock changes (a skipped or repeated local time) are rejected, not guessed."
        />
        <TextField
          id="cp-urltpl"
          label="Link to a ticket in your helpdesk"
          mono
          value={String(config.ticketUrlTemplate ?? "")}
          onChange={(v) => set(["ticketUrlTemplate"], v === "" ? undefined : v)}
          placeholder="https://app.helpdesk.example.com/tickets/{id}"
          hint="Used only to show links and recognize them. Never requested."
        />
      </div>
      <MapEditor idPrefix="cp-status-map" label="Status values" value={statusMap} targets={STATES} onChange={(next) => set(["valueMaps", "status"], next)} hint="Every status your system uses, mapped to an Elapsed status. An unmapped status fails that ticket unless you choose the fallback below." />
      <SelectField
        id="cp-unknown"
        label="A status that is not listed"
        value={String(config.unknownStatus ?? "fail")}
        onChange={(v) => set(["unknownStatus"], v)}
        options={[
          { value: "fail", label: "Fail the ticket (recommended)" },
          { value: "open", label: "Treat it as Open" },
        ]}
      />
      <MapEditor idPrefix="cp-prio-map" label="Priority values" value={priorityMap} targets={PRIORITIES} onChange={(next) => set(["valueMaps", "priority"], Object.keys(next).length ? next : undefined)} hint="An unmapped priority is left empty and reported, never passed through." />
    </div>
  );
}
