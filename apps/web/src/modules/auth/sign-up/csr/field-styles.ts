import { authLabelClass } from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";

export const fieldClass =
  "h-10 rounded-[2px] bg-background px-3 text-sm placeholder:text-foreground-subtle focus:bg-surface-raised";

export const iconClass =
  "pointer-events-none absolute inset-e-3 size-4.5 text-foreground-subtle";

export const fieldLabelClass = cn(authLabelClass, "text-muted-foreground");
