"use client";

import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminPanel, Fact, Tag } from "@/components/admin/admin-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatUtcTimestamp } from "@/lib/admin-format";
import { formatIntervalMs, formatNextCycle } from "@/lib/format";
import type { IntervalOption } from "@/lib/types/worker-settings";
import { cn } from "@/lib/utils";

/** "5 minutes" → "5m", "30 seconds" → "30s": the picker is a row of small chips. */
function compactInterval(label: string): string {
  return label
    .replace(/ seconds?$/, "s")
    .replace(/ minutes?$/, "m")
    .replace(/ hours?$/, "h")
    .replace(/ days?$/, "d");
}

interface IntervalSettingRowProps {
  label: string;
  description: string;
  /** Short caption in the corner, e.g. "Hot path". */
  badge: string;
  valueMs: number;
  /** When the worker last ran this cycle, as reported by the worker itself. */
  lastCycleAt: string | null;
  /** The worker scheduler's own next-run time; null until it has armed a timer. */
  nextCycleAt: string | null;
  options: IntervalOption[];
  canEdit: boolean;
  onSave: (ms: number) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * One worker cycle ("Active monitoring" or "Reconciliation"): the interval as
 * a row of choices, with the cycle's last and next times beside it. Choosing
 * and saving is the only way to change it, and saving is an audited admin
 * action (`update_worker_settings`).
 */
export function IntervalSettingRow({
  label,
  description,
  badge,
  valueMs,
  lastCycleAt,
  nextCycleAt,
  options,
  canEdit,
  onSave,
}: IntervalSettingRowProps) {
  const [selected, setSelected] = useState(valueMs);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSelected(valueMs);
  }, [valueMs]);

  const dirty = selected !== valueMs;

  async function handleSave() {
    setSaving(true);
    setResult(null);
    const outcome = await onSave(selected);
    setSaving(false);

    if (!outcome.ok) {
      setResult({ ok: false, message: outcome.error ?? "Failed to save" });
      return;
    }
    setResult({
      ok: true,
      message: `${label} changed to ${formatIntervalMs(selected)}. Applies on the worker's next tick.`,
    });
  }

  return (
    <AdminPanel className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-foreground text-base font-semibold">{label}</h3>
          <p className="text-muted-foreground mt-0.5 text-sm leading-5">
            {description}
          </p>
        </div>
        <Tag tone="primary">{badge}</Tag>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-foreground-subtle font-mono text-[10px] font-semibold tracking-[0.08em] uppercase">
          Interval · now {formatIntervalMs(valueMs)}
        </span>
        <div
          role="radiogroup"
          aria-label={`${label} interval`}
          className="flex flex-wrap gap-1.5"
        >
          {options.map((option) => {
            const active = option.ms === selected;
            return (
              <button
                key={option.ms}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!canEdit || saving}
                onClick={() => setSelected(option.ms)}
                className={cn(
                  "min-w-14 rounded border px-3 py-2 font-mono text-xs font-semibold transition-colors disabled:cursor-not-allowed",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground enabled:hover:border-border-strong enabled:hover:text-foreground",
                  !active &&
                    option.ms === valueMs &&
                    "border-primary/50 text-foreground",
                )}
              >
                {compactInterval(option.label)}
              </button>
            );
          })}
        </div>
      </div>

      <dl className="border-border grid gap-4 border-t pt-3 sm:grid-cols-2">
        <Fact label="Last cycle" mono>
          {formatUtcTimestamp(lastCycleAt)}
        </Fact>
        <Fact label="Next cycle" mono>
          {nextCycleAt
            ? formatUtcTimestamp(nextCycleAt)
            : "Pending first cycle"}
          {nowMs !== null && nextCycleAt && (
            <span className="text-foreground-subtle block text-xxs">
              {formatNextCycle(nextCycleAt, nowMs)}
            </span>
          )}
        </Fact>
      </dl>

      {result && (
        <Alert variant={result.ok ? "success" : "destructive"}>
          {result.ok ? <CheckCircle2 /> : <AlertCircle />}
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}

      {canEdit ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-foreground-subtle font-mono text-[10px]">
            Saving is recorded in the audit log.
          </p>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                type="button"
                variant="subtle"
                size="compact"
                className="font-mono text-xs"
                onClick={() => setSelected(valueMs)}
                disabled={saving}
              >
                Reset
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="font-mono text-xs"
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Saving…" : "Save cadence"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-foreground-subtle font-mono text-[10px]">
          View only.
        </p>
      )}
    </AdminPanel>
  );
}
