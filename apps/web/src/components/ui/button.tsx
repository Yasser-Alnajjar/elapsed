import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Shine sweep + eased transition shared by the solid/outline/link variants. */
const SHINE = "btn-shine transition-all duration-200";
/** Type/radius/spacing defaults for the standard height-based sizes. */
const STD = "gap-2 rounded-md text-sm font-medium [&_svg]:size-4";

const buttonVariants = cva(
  "cursor-pointer inline-flex items-center justify-center whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: `${SHINE} bg-primary text-primary-foreground shadow-soft hover:bg-primary-hover active:brightness-95`,
        secondary: `${SHINE} bg-secondary text-secondary-foreground shadow-soft hover:brightness-105 active:brightness-95`,
        outline: `${SHINE} border border-border bg-transparent text-foreground hover:bg-interactive/60 active:bg-interactive`,
        ghost: `${SHINE} text-foreground hover:bg-interactive/60 active:bg-interactive`,
        destructive: `${SHINE} bg-error text-error-foreground shadow-soft hover:brightness-110 active:brightness-95`,
        link: `${SHINE} text-primary underline-offset-4 hover:underline`,
        /** Raised tonal action on the dashboard surface scale. */
        surface:
          "bg-surface-container-high text-on-surface shadow-soft hover:bg-surface-active",
        /** Emphasised tonal action (primary container). */
        tonal:
          "bg-primary-container text-on-primary-container hover:bg-primary-hover hover:text-on-primary",
        /** Quiet text-only control, e.g. a dismiss "x". */
        subtle: "text-outline hover:text-on-surface",
        /** Filter chip; the selected state is driven by `aria-pressed`. */
        filter:
          "text-muted-foreground hover:bg-interactive/60 aria-pressed:bg-interactive aria-pressed:text-primary",
        /** No colours — the caller supplies the full colour treatment. */
        bare: "",
      },
      size: {
        default: `h-9 px-4 py-2 ${STD}`,
        sm: `h-8 px-3 ${STD} text-xs`,
        lg: `h-10 px-6 ${STD}`,
        icon: `size-9 ${STD}`,
        toolbar: "gap-2 rounded px-3.5 py-2 text-sm",
        compact: "gap-1 rounded px-3 py-1.5 text-sm font-medium",
        chip: "rounded-md px-2.5 py-1 text-xs font-medium",
        "icon-xs": "p-1",
        bare: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
