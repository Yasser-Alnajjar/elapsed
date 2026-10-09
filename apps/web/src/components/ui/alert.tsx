import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative flex w-full items-start gap-3 rounded-lg border p-4 text-sm [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-border bg-interactive/40 text-foreground",
        destructive: "border-error/30 bg-error/10 text-error",
        warning: "border-warning/30 bg-warning/10 text-warning",
        success: "border-success/30 bg-success/10 text-success",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

// A callout label, not a section heading: a heading element here would jump a
// docs page from h2 straight to h5 and put noise in the document outline.
const AlertTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-medium leading-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    className={cn("min-w-0 text-sm leading-relaxed [&_p]:leading-relaxed", className)}
    ref={ref}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
