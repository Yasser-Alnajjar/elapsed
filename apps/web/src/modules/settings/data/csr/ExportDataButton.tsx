"use client";

import { Download, FileDown, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DEFAULT_EXPORT_FORMAT,
  EXPORT_FORMATS,
  exportFormat,
  type ExportFormatId,
} from "@/lib/data-export/formats";
import type { IntegrationDataCounts } from "@/lib/types/data";
import type { IntegrationProvider } from "@/lib/types/integrations";
import { cn } from "@/lib/utils";
import { DataCountsList } from "./DataCountsList";

interface ExportDataButtonProps {
  provider: IntegrationProvider;
  providerLabel: string;
  /** What a complete-data format covers, shown before download so the scope is never a surprise. */
  counts: IntegrationDataCounts;
  disabled?: boolean;
}

/**
 * Downloads an integration's stored data in a chosen format. Read-only and
 * independent of cleanup: it deletes nothing and a cleanup never makes one.
 * The complete-data formats (JSON Lines, JSON, CSV) are backups; the PDF is a
 * summary report and is labelled as one. It is a plain form POST rather than a
 * `fetch`, so the browser streams the (potentially large) file straight to disk
 * instead of buffering it in the page.
 */
export function ExportDataButton({
  provider,
  providerLabel,
  counts,
  disabled,
}: ExportDataButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormatId>(DEFAULT_EXPORT_FORMAT);
  const selected = exportFormat(format);

  function handleSubmit() {
    setOpen(false);
    // The operation is recorded as the download starts; show it in the activity list.
    setTimeout(() => router.refresh(), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="surface" disabled={disabled}>
          <FileDown className="size-3.5" />
          Export
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Back up or export {providerLabel} data</DialogTitle>
          <DialogDescription>
            Choose a format. This changes nothing — no data is modified or
            deleted.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={format}
          onValueChange={(value) => setFormat(value as ExportFormatId)}
          className="gap-2"
          aria-label="Download format"
        >
          {EXPORT_FORMATS.map((option) => (
            <label
              key={option.id}
              htmlFor={`export-format-${provider}-${option.id}`}
              className={cn(
                "bg-surface-container flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                option.id === format ? "border-primary" : "border-transparent",
              )}
            >
              <RadioGroupItem
                id={`export-format-${provider}-${option.id}`}
                value={option.id}
                className="mt-0.5"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-on-surface">
                  {option.label}
                  <span className="font-mono text-xxs font-normal text-outline">
                    .{option.extension}
                  </span>
                  <span
                    className={cn(
                      "rounded border px-1.5 py-px font-mono text-xxs font-semibold uppercase",
                      option.complete
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-warning/35 bg-warning/10 text-warning-text",
                    )}
                  >
                    {option.complete ? "Complete" : "Summary"}
                  </span>
                </span>
                <span className="text-xs text-on-surface-variant">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>

        {selected.complete && <DataCountsList counts={counts} />}

        <div className="text-on-surface-variant flex items-start gap-2 text-xs">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            {selected.complete
              ? "Provider credentials and the webhook secret are never included. Records are read while the integration may still be changing, so it is not a point-in-time snapshot. "
              : "The report is built from totals and the 25 most recent cases; it does not include record contents. "}
            The download is recorded in Activity.
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>

          <form
            method="post"
            action={`/api/integrations/${provider}/export`}
            onSubmit={handleSubmit}
          >
            <input type="hidden" name="format" value={format} />
            <Button type="submit">
              <Download className="size-3.5" />
              Download {selected.short}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
