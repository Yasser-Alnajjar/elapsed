"use client";

import { ListFilter, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const labelClass = "text-on-surface-variant text-xs font-medium";
const hintClass = "text-on-surface-variant/70 text-xs";

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
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
  suggestions,
  mono = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  type?: "text" | "password" | "number";
  /** Paths from the sample ticket to pick from; free text is still allowed. */
  suggestions?: string[];
  mono?: boolean;
}) {
  const input = (
    <Input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      className={mono ? "font-mono" : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      {suggestions && suggestions.length > 0 ? (
        <div className="flex items-center gap-1.5">
          {input}
          <PathPicker label={label} paths={suggestions} onPick={onChange} />
        </div>
      ) : (
        input
      )}
    </Field>
  );
}

/** The paths found in the sample ticket; picking one fills the field. */
function PathPicker({
  label,
  paths,
  onPick,
}: {
  label: string;
  paths: string[];
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Pick a path for ${label}`}
          className="size-8 shrink-0"
        >
          <ListFilter />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-64 w-72 overflow-y-auto p-1">
        <ul aria-label="Paths in your sample ticket">
          {paths.map((path) => (
            <li key={path}>
              <Button
                type="button"
                variant="ghost"
                size="bare"
                className="w-full justify-start rounded px-2 py-1 font-mono text-xs"
                onClick={() => {
                  onPick(path);
                  setOpen(false);
                }}
              >
                {path}
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
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
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function CheckField({
  id,
  label,
  checked,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-on-surface text-sm">
          {label}
        </Label>
        {hint && <p className={hintClass}>{hint}</p>}
      </div>
    </div>
  );
}

/**
 * Keeps what the user is typing apart from the saved value. `canonical` maps typed text to the form the saved
 * value would have; while they agree the typed text is left alone (so a half-typed line or half-typed JSON is not
 * reverted), and when the saved value changes from elsewhere the text follows it.
 */
export function TextAreaField({
  id,
  label,
  value,
  onChange,
  hint,
  rows = 4,
  mono = true,
  canonical = (text) => text,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  rows?: number;
  mono?: boolean;
  canonical?: (text: string, current: string) => string;
}) {
  const [text, setText] = useState(value);
  if (canonical(text, value) !== value) setText(value);
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Textarea
        id={id}
        rows={rows}
        value={text}
        className={mono ? "font-mono text-xs" : "text-xs"}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value);
        }}
      />
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
  const rename = (from: string, to: string) =>
    onChange(
      Object.fromEntries(entries.map(([k, v]) => [k === from ? to : k, v])),
    );
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className={labelClass}>{label}</span>
      {entries.map(([source, target], index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={`${label}: value in your system`}
            className="font-mono"
            value={source}
            onChange={(event) => rename(source, event.target.value)}
          />
          <span className="text-on-surface-variant">→</span>
          <Select
            value={target}
            onValueChange={(next) => onChange({ ...value, [source]: next })}
          >
            <SelectTrigger aria-label={`${label}: Elapsed value`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="subtle"
            size="icon-xs"
            aria-label={`Remove ${source}`}
            onClick={() =>
              onChange(
                Object.fromEntries(entries.filter(([k]) => k !== source)),
              )
            }
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        id={`${idPrefix}-add`}
        variant="link"
        size="bare"
        className="self-start text-xs"
        onClick={() =>
          onChange({
            ...value,
            [`value${entries.length + 1}`]: targets[0]!.value,
          })
        }
      >
        Add a value
      </Button>
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  );
}
