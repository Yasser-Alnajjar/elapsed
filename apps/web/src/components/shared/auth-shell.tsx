import * as React from "react";
import type { ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "../ui/theme-toggle";

/*
 * Auth surface matching the Stitch "elapsed_*" screens: a dark canvas, a
 * shared top bar + footer, and per-screen cards built from the pieces below.
 * Palette (hex) comes straight from the design's tailwind config.
 */

/** 10px mono, uppercase micro-label. */
export const authLabelClass =
  "font-mono text-[10px] font-semibold uppercase leading-3 tracking-[0.06em]";

/** Base for every text field: canvas fill, sky focus ring. */
const authInputBase =
  "w-full text-foreground placeholder:text-foreground-subtle transition-all focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Solid sky primary action. */
export const authButtonClass =
  "group flex w-full items-center justify-center gap-2 rounded-[2px] bg-primary text-sm font-semibold tracking-wide text-primary-foreground transition-all duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

export const AuthInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(authInputBase, className)} {...props} />
));
AuthInput.displayName = "AuthInput";

/** Inline validation message under a field. */
export function AuthFieldError({
  id,
  message,
}: {
  id: string;
  message?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-error">
      {message}
    </p>
  );
}

/** Show/hide button that sits inside a password field's trailing edge. */
export function PasswordVisibilityToggle({
  shown,
  onToggle,
  className,
  iconClassName,
}: {
  shown: boolean;
  onToggle: () => void;
  className?: string;
  iconClassName?: string;
}) {
  const Icon = shown ? EyeOff : Eye;
  return (
    <button
      type="button"
      aria-label="Toggle password visibility"
      onClick={onToggle}
      className={className}
    >
      <Icon aria-hidden className={iconClassName} />
    </button>
  );
}

function AuthHeader() {
  return (
    <header className="relative z-10 w-full border-b border-border bg-background/60 backdrop-blur-xl">
      <div className="flex h-14 w-full items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <BrandLogo className="size-6" />
          <span className="font-mono text-base font-bold uppercase leading-6 tracking-tight text-foreground">
            ELAPSED
          </span>
          <span className={cn(authLabelClass, "text-foreground-subtle")}>
            |
          </span>
          <span className={cn(authLabelClass, "text-primary")}>LIVE SLA</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Full-page frame: backdrop, top bar, centred content, footer. */
export function AuthPage({
  children,
  mainClassName,
}: {
  children: ReactNode;
  mainClassName?: string;
}) {
  return (
    <div className="relative flex min-h-screen overflow-x-clip flex-col justify-between bg-surface-container-lowest font-inter text-foreground selection:bg-primary selection:text-primary-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklch,var(--color-primary)_8%,transparent),transparent_55%),radial-gradient(circle_at_50%_100%,color-mix(in_oklch,var(--color-background)_80%,transparent),transparent_70%)]"
      />
      <AuthHeader />
      <main
        className={cn(
          "relative z-10 flex w-full flex-1 items-center justify-center px-4 py-8 md:px-6",
          mainClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}

/**
 * Simple centred card (the sign-in card chrome) for the auth screens that have
 * no dedicated design: verify-email and accept-invite.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <AuthPage>
      <div className="relative z-10 w-full max-w-115 rounded-lg bg-linear-to-b from-primary/30 via-border-strong to-border p-px shadow-[0_24px_50px_-12px_rgba(6,10,18,0.95)]">
        <div className="flex flex-col gap-4 rounded-[calc(0.5rem-1px)] bg-background p-6">
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-[28px] font-bold leading-9 tracking-[-0.015em] text-foreground">
              {title}
            </h1>
            <p className="max-w-85 text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
          {children}
          {footer && (
            <div className="border-t border-border/80 pt-3 text-center text-xs text-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </div>
    </AuthPage>
  );
}

const alertTones = {
  danger: "border-error/40 bg-error/10 text-error",
  warning: "border-warning/40 bg-warning/10 text-warning-text",
  success: "border-success/40 bg-success/10 text-success",
} as const;

/** Inline status banner in the design's mono/dark treatment. */
export function AuthAlert({
  tone,
  icon,
  children,
}: {
  tone: keyof typeof alertTones;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "success" ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-[2px] border px-3 py-2 text-xs leading-4 [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0",
        alertTones[tone],
      )}
    >
      {icon}
      <div>{children}</div>
    </div>
  );
}
