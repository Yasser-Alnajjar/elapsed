import type { ReactNode } from "react";
import { Reveal } from "@/components/shared/reveal";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Shared card shell for provider integrations — a flat single surface (no
 * header divider) so the cards read as lightweight tiles rather than
 * boxed panels.
 */
export function IntegrationCardShell({
  delay,
  icon,
  connected,
  title,
  subtitle,
  tag,
  badge,
  status,
  children,
}: {
  delay: number;
  icon: ReactNode;
  connected: boolean;
  title: string;
  subtitle: string;
  /** Uppercase category chip next to the title (TICKETS / ENGINEERING / DISPATCH). */
  tag: string;
  /** Optional label next to the title — e.g. `<Badge variant="beta">Beta</Badge>` for Intercom/GitHub (roadmap task 2.10). */
  badge?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Reveal delay={delay}>
      <Card className="bg-surface-container-low relative flex h-full flex-col gap-4 overflow-hidden rounded-xl border-0 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "bg-surface-container-highest flex size-10 shrink-0 items-center justify-center rounded",
                connected ? "text-primary" : "text-outline",
              )}
            >
              {icon}
            </span>

            <div className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center gap-1.5">
                <CardTitle className="text-on-surface truncate text-lg font-medium">
                  {title}
                </CardTitle>
                <span className="bg-surface-container text-on-surface-variant rounded px-1.5 py-0.5 font-mono text-xxs">
                  {tag}
                </span>
                {badge}
              </div>
              <p className="text-on-surface-variant truncate text-xs">
                {subtitle}
              </p>
            </div>
          </div>

          {status}
        </div>

        <div className="flex flex-1 flex-col">{children}</div>
      </Card>
    </Reveal>
  );
}
