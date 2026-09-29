import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatTile({
  icon: Icon,
  label,
  value,
  trend,
  detail,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  trend?: ReactNode;
  /** Secondary breakdown/aggregate line rendered below the value, separated by a hairline — only pass data already present in the page's props, never a fabricated figure. */
  detail?: ReactNode;
  tone?: "default" | "destructive" | "success" | "warning";
}) {
  return (
    <Card className="relative overflow-hidden rounded-xl p-5 shadow-none">
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-e-0 top-0 size-24 rounded-bl-full bg-gradient-to-bl to-transparent",
          tone === "destructive" && "from-error/15",
          tone === "success" && "from-success/15",
          tone === "warning" && "from-warning/15",
          tone === "default" && "from-primary/10",
        )}
      />
      <div className="relative flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-md border border-border-subtle",
            tone === "destructive" && "bg-error/10 text-error",
            tone === "success" && "bg-success/10 text-success",
            tone === "warning" && "bg-warning/10 text-warning",
            tone === "default" && "bg-interactive text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <div className="relative mt-3 flex items-baseline gap-2">
        <p className="font-mono text-3xl font-bold leading-none tracking-tight tabular-nums">
          {value}
        </p>
        {trend}
      </div>
      {detail && (
        <div className="relative -mx-5 -mb-5 mt-4 border-t border-border-subtle bg-surface-subtle px-5 py-3 text-xs text-muted-foreground">
          {detail}
        </div>
      )}
    </Card>
  );
}
