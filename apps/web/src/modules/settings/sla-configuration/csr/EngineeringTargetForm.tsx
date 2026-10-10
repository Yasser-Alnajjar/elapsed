"use client";

import { AlertCircle, Info, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { Input } from "@/components/ui/input";
import { formatTargetClock, InfoNote, tableHeadClass } from "./SlaSection";

/** Set/clear form for the org-wide engineering-leg OLA target (roadmap step 16). */
export function EngineeringTargetForm({
  initialTargetMinutes,
}: {
  initialTargetMinutes: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(initialTargetMinutes === null);
  const [hours, setHours] = useState(
    initialTargetMinutes !== null
      ? String(Math.round(initialTargetMinutes / 60))
      : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const parsedHours = Number(hours);
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      setError("Enter a positive number of hours");
      return;
    }

    setSaving(true);
    setError(null);

    const { ok, body } = await Actions.SlaConfiguration.setEngineeringTarget(
      Math.round(parsedHours * 60),
    );
    setSaving(false);

    if (!ok) {
      notify.error(body.error ?? "Failed to save target.");
      return;
    }

    setEditing(false);
    router.refresh();
  }

  async function handleClear() {
    setSaving(true);
    setError(null);

    const { ok } = await Actions.SlaConfiguration.clearEngineeringTarget();
    setSaving(false);

    if (!ok) {
      notify.error("Failed to clear target.");
      return;
    }

    setHours("");
    setEditing(true);
    router.refresh();
  }

  const hasTarget = initialTargetMinutes !== null;

  return (
    <div className="flex flex-1 flex-col justify-between gap-4">
      <div className="flex flex-col gap-4">
        <div className="bg-surface-container flex flex-col gap-2 rounded-lg p-4">
          <div className="flex items-baseline justify-between">
            <span className={tableHeadClass}>Deterministic target runway</span>
            <span
              className={
                hasTarget
                  ? "text-success font-mono text-xxs font-semibold"
                  : "text-outline font-mono text-xxs font-semibold"
              }
            >
              {hasTarget ? "● ACTIVE RULE" : "○ NOT SET"}
            </span>
          </div>

          {editing ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                placeholder="Hours"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-24 font-mono"
              />
              <span className="text-on-surface-variant text-sm">hours</span>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving && <Loader2 className="animate-spin" />}
                {saving ? "Saving…" : "Set target"}
              </Button>
              {hasTarget && (
                <Button
                  type="button"
                  size="sm"
                  variant="surface"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-primary font-mono text-3xl font-bold tabular-nums tracking-tight">
                {formatTargetClock(initialTargetMinutes!)}
              </span>
              <span className="text-outline font-mono text-xxs">
                wall-clock cap
              </span>
            </div>
          )}

          <p className="text-on-surface-variant text-xs">
            Cases exceeding this duration in the engineering leg are marked
            at-risk or breached.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <InfoNote icon={<Info className="size-4" />}>
          One target for the whole team — not a policy builder. The engineering
          leg runs from the moment support hands a case to engineering until it
          is resolved.
        </InfoNote>
      </div>

      {!editing && hasTarget && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-error"
            onClick={handleClear}
            disabled={saving}
          >
            {saving && <Loader2 className="animate-spin" />}
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            variant="surface"
            onClick={() => setEditing(true)}
          >
            Change target
          </Button>
        </div>
      )}
    </div>
  );
}
