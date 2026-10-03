import { FileText, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConciergeProviderCopy } from "@/lib/concierge-providers";

/** What the ZIP contains, and the read-only promise. */
export function ExportSidebar({ copy }: { copy: ConciergeProviderCopy }) {
  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center gap-2 border-b px-6 py-4">
          <FileText className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">
            Archive contents
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 py-5">
          <ul className="space-y-1 rounded-lg bg-muted/30 p-4 font-mono text-xs">
            {copy.archiveFiles.map((file) => (
              <li
                key={file.name}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="text-foreground">{file.name}</span>
                <span className="text-end text-xxs text-muted-foreground">
                  {file.description}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 px-6 py-5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-primary">
            <Shield className="size-4" />
          </span>
          <div>
            <p className="font-mono text-xxs font-bold uppercase tracking-wider text-primary">
              Read-only
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The export only reads from {copy.label}. Nothing in your workspace
              is created, updated or deleted.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
