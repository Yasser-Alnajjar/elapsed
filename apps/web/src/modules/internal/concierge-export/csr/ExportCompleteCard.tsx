import { BadgeCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ConciergeProviderCopy } from "@/lib/concierge-providers";
import type { CompletedExport } from "./useConciergeExport";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <span className="font-mono text-2xl font-bold">{value}</span>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** The finished export: file name, download link, and record / history counts. */
export function ExportCompleteCard({
  copy,
  completed,
}: {
  copy: ConciergeProviderCopy;
  completed: CompletedExport;
}) {
  return (
    <Card className="relative overflow-hidden border-success/30">
      <div className="absolute inset-x-0 top-0 h-1 bg-success" />
      <CardContent className="space-y-5 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-success/10 text-success">
              <BadgeCheck className="size-6" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Export complete</h3>
                <span className="rounded bg-success/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-success">
                  Ready
                </span>
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {completed.summary.fileName}
              </p>
            </div>
          </div>
          <Button asChild size="sm">
            <a href={completed.url} download={completed.summary.fileName}>
              <Download />
              Download ZIP
            </a>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat value={completed.summary.recordCount} label={copy.recordNoun} />
          <Stat
            value={completed.summary.historyCount}
            label={copy.historyNoun}
          />
        </div>
      </CardContent>
    </Card>
  );
}
