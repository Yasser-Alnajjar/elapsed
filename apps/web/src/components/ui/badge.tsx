import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-interactive text-foreground",
        primary: "border-transparent bg-primary/15 text-primary",
        secondary: "border-transparent bg-secondary/20 text-secondary",
        success: "border-transparent bg-success/15 text-success",
        warning: "border-transparent bg-warning/15 text-warning-text",
        destructive: "border-transparent bg-error/15 text-error",
        outline: "border-border text-muted-foreground",
        tertiary: "border-transparent bg-tertiary/15 text-tertiary",
        /** Muted/neutral tone, deliberately distinct from every semantic color above — labels a feature as Beta (roadmap task 2.10), not a status. */
        beta: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
