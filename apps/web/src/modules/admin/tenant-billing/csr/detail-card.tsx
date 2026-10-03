import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AdminPanel } from "@/components/admin/admin-ui";
import { cn } from "@/lib/utils";

/** The shell of the three profile cards: icon + caption + badge, body, and a footer line with one action. */
export function DetailCard({
  icon: Icon,
  iconClassName,
  title,
  badge,
  children,
  footer,
  action,
}: {
  icon: LucideIcon;
  iconClassName: string;
  title: string;
  badge: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  action?: { label: string; onClick: () => void; chevron?: boolean };
}) {
  return (
    <AdminPanel className="flex flex-col justify-between gap-4 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-[0.04em] uppercase">
            <Icon aria-hidden className={cn("size-4.5", iconClassName)} />
            {title}
          </h2>
          {badge}
        </div>
        {children}
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
        <span className="text-foreground-subtle min-w-0 truncate">{footer}</span>
        {action && (
          <button type="button" onClick={action.onClick} className="text-primary flex shrink-0 items-center gap-0.5 hover:underline">
            {action.label}
            {action.chevron && <ChevronRight aria-hidden className="size-3.5" />}
          </button>
        )}
      </div>
    </AdminPanel>
  );
}
