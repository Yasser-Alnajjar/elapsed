"use client";

import { Download, Link2, RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type AtRiskHeaderProps = {
  totalCount: number;
  onExport: () => void;
  onRefresh: () => void;
  linkedCertainCount: number;
};

export const AtRiskHeader = ({
  totalCount,
  onExport,
  onRefresh,
  linkedCertainCount,
}: AtRiskHeaderProps) => {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            At Risk
          </h1>

          <Badge variant="destructive">
            <span className="size-2 animate-ping rounded-full bg-error" />
            {totalCount} Active At-Risk Case
            {totalCount !== 1 ? "s" : ""}
          </Badge>

          <Badge variant="tertiary">
            <span className="size-1.5 animate-ping rounded-full bg-tertiary" />
            Live Clock Daemon: Continuous (Deterministic)
          </Badge>
          <Badge variant="beta">
            <Link2 className="size-3.5 text-success" />
            Linked: Certain ({linkedCertainCount}/{totalCount})
          </Badge>
        </div>

        <p className="max-w-3xl text-sm leading-5 text-muted-foreground">
          Active SLA countdowns burning runway across ticket and engineering handoffs.
          Queue latency and transit bottlenecks are unpaused and incurring
          real-time penalty.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onExport}
          disabled={totalCount === 0}
          className="gap-1.5 bg-surface-container hover:bg-surface-container-high"
        >
          <Download className="size-4 text-muted-foreground" />
          Export Incident List
        </Button>

        <Button
          size="sm"
          onClick={onRefresh}
          className="gap-1.5 bg-primary-container text-on-primary hover:bg-primary-hover"
        >
          <RefreshCcw className="size-4" />
          Sync Pulse (Auto 5s)
        </Button>
      </div>
    </header>
  );
};
