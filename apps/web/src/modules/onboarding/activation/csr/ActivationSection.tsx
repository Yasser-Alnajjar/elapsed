import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** A titled activation-screen section: small caps heading with an icon, then its content. */
export function ActivationSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="size-[18px] text-on-surface-variant shrink-0" />
        <h3 className="font-label-caps text-label-caps uppercase tracking-wide text-on-surface-variant">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}
