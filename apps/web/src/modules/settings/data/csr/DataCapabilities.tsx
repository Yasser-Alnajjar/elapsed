import { FileDown, Trash2, type LucideIcon } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Capability {
  icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * What this page can do. A new data-management capability is one more entry
 * here plus a section component in `DataView` — nothing above or beside it
 * has to be restructured.
 */
const CAPABILITIES: Capability[] = [
  {
    icon: FileDown,
    title: "Backup & export",
    description:
      "Download an integration's stored data as JSON Lines, JSON or CSV, or a PDF summary report. Read-only: nothing is changed, and it never runs on its own.",
  },
  {
    icon: Trash2,
    title: "Cleanup",
    description:
      "Permanently delete one disconnected integration's stored data. The integration itself stays, and so does everything other integrations own.",
  },
];

export function DataCapabilities() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {CAPABILITIES.map(({ icon: Icon, title, description }) => (
        <Card key={title} className="bg-surface-container-low rounded-xl border-0 shadow-sm">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <span className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-container-highest text-primary">
              <Icon className="size-4" />
            </span>
            <div className="space-y-1">
              <CardTitle className="text-on-surface text-base font-semibold tracking-tight">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
