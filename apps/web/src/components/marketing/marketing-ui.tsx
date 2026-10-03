import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Mono micro-label used for eyebrows, chips and table section rows. */
export const MONO_LABEL =
  "font-mono text-[10px] leading-3 font-semibold tracking-[0.06em] uppercase";

/** Mono caption used for fine print under CTAs. */
export const MONO_CAPTION =
  "font-mono text-[11px] leading-[14px] font-semibold tracking-[0.04em]";

/** Page-width container shared by every marketing section. */
export function MarketingContainer({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("mx-auto w-full max-w-300 px-4 lg:px-6", className)}
      {...props}
    />
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "start",
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "start" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      <span className={cn(MONO_LABEL, "text-primary tracking-widest")}>
        {eyebrow}
      </span>
      <h2 className="mt-2 text-[28px] leading-9 font-semibold tracking-[-0.015em] text-foreground">
        {title}
      </h2>
      {description && (
        <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

const CTA_VARIANTS = {
  primary:
    "bg-primary text-primary-foreground font-semibold hover:bg-primary-hover hover:shadow-glow",
  secondary: "bg-card text-foreground font-medium hover:bg-surface-raised",
  outline:
    "border border-border bg-transparent text-foreground font-medium hover:border-border-strong hover:bg-surface-hover",
} as const;

export function MarketingCta({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof CTA_VARIANTS;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center rounded text-sm transition-all",
        size === "sm" ? "h-9 px-4" : "h-10 px-5",
        CTA_VARIANTS[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Text link with a trailing arrow ("Read the documentation →"). */
export function ArrowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "text-primary font-mono text-xs hover:underline",
        className,
      )}
    >
      {children} →
    </Link>
  );
}
