"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatIntervalMs } from "@/lib/format";
import type { IntervalOption } from "@/lib/types/worker-settings";

interface IntervalSettingRowProps {
  label: string;
  description: string;
  valueMs: number;
  options: IntervalOption[];
  canEdit: boolean;
  onSave: (ms: number) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * One editable interval — "Active monitoring" or "Reconciliation" — on the
 * Monitoring settings page. Both rows post the *pair* of intervals to
 * `/api/settings/worker` (it's one global row — see `WorkerSettings`'s doc
 * comment), but each row edits and saves independently, matching the UI
 * spec's per-row "Edit" control.
 */
export function IntervalSettingRow({ label, description, valueMs, options, canEdit, onSave }: IntervalSettingRowProps) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(String(valueMs));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Keeps this row's dropdown in sync when the parent's SSR data changes
  // underneath it (e.g. after `router.refresh()` from saving the *other*
  // row, which re-fetches both intervals together).
  useEffect(() => {
    setSelected(String(valueMs));
  }, [valueMs]);

  async function handleSave() {
    setSaving(true);
    setResult(null);
    const ms = Number(selected);
    const outcome = await onSave(ms);
    setSaving(false);

    if (!outcome.ok) {
      setResult({ ok: false, message: outcome.error ?? "Failed to save" });
      return;
    }

    setEditing(false);
    setResult({ ok: true, message: `${label} changed to ${formatIntervalMs(ms)}.` });
  }

  return (
    <div className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-sm text-on-surface-variant">{description}</p>
        </div>

        {!editing ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Every {formatIntervalMs(valueMs)}</span>
            {canEdit && (
              <Button type="button" size="sm" variant="surface" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.ms} value={String(option.ms)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="surface"
              onClick={() => {
                setEditing(false);
                setSelected(String(valueMs));
                setResult(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {result && (
        <Alert variant={result.ok ? "success" : "destructive"}>
          {result.ok ? <CheckCircle2 /> : <AlertCircle />}
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
