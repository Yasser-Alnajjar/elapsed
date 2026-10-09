"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const labelClass = "text-on-surface-variant text-xs font-medium";
const hintClass = "text-on-surface-variant/70 text-xs";
export const selectClass =
  "border-input bg-background text-foreground h-8 w-full rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:ring-input focus-visible:outline-none";

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className={labelClass}>
        {label}
      </Label>
      {children}
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  placeholder,
  type = "text",
  list,
  mono = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  type?: "text" | "password" | "number";
  list?: string;
  mono?: boolean;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        type={type}
        value={value}
        list={list}
        placeholder={placeholder}
        autoComplete="off"
        className={mono ? "font-mono" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-0.5 size-4" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-on-surface text-sm">
          {label}
        </Label>
        {hint && <p className={hintClass}>{hint}</p>}
      </div>
    </div>
  );
}

export function TextAreaField({ id, label, value, onChange, hint, rows = 4, mono = true }: { id: string; label: string; value: string; onChange: (value: string) => void; hint?: string; rows?: number; mono?: boolean }) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Textarea id={id} rows={rows} value={value} className={mono ? "font-mono text-xs" : "text-xs"} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

/** Rows of `source value -> target` for the value maps. */
export function MapEditor({
  idPrefix,
  label,
  hint,
  value,
  targets,
  onChange,
}: {
  idPrefix: string;
  label: string;
  hint?: string;
  value: Record<string, string>;
  targets: { value: string; label: string }[];
  onChange: (next: Record<string, string>) => void;
}) {
  const entries = Object.entries(value);
  const rename = (from: string, to: string) => onChange(Object.fromEntries(entries.map(([k, v]) => [k === from ? to : k, v])));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={labelClass}>{label}</legend>
      {entries.map(([source, target], index) => (
        <div key={index} className="flex items-center gap-2">
          <Input aria-label={`${label}: value in your system`} className="font-mono" value={source} onChange={(event) => rename(source, event.target.value)} />
          <span className="text-on-surface-variant">→</span>
          <select aria-label={`${label}: Elapsed value`} className={selectClass} value={target} onChange={(event) => onChange({ ...value, [source]: event.target.value })}>
            {targets.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="text-on-surface-variant hover:text-on-surface px-1 text-sm"
            aria-label={`Remove ${source}`}
            onClick={() => onChange(Object.fromEntries(entries.filter(([k]) => k !== source)))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        id={`${idPrefix}-add`}
        className="text-primary self-start text-xs hover:underline"
        onClick={() => onChange({ ...value, [`value${entries.length + 1}`]: targets[0]!.value })}
      >
        Add a value
      </button>
      {hint && <p className={hintClass}>{hint}</p>}
    </fieldset>
  );
}
