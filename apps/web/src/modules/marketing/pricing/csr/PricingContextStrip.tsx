import Link from "next/link";
import { TONE_DOT, TONE_SURFACE, TONE_TEXT } from "@/lib/status-styles";
import type { PricingContextStrip as Strip } from "@/lib/types/pricing";
import { cn } from "@/lib/utils";

/** Where the signed-in organization stands: trial, plan, scheduled change, payment, or read-only. */
export function PricingContextStrip({ strip }: { strip: Strip }) {
  const emphasised = strip.tone === "warning" || strip.tone === "danger";
  const aside = strip.aside;
  const asideClass = cn("shrink-0 font-mono text-[11px] font-medium", aside?.tone ? TONE_TEXT[aside.tone] : "text-muted-foreground");

  return (
    <div
      role="status"
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-lg border px-4 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3",
        emphasised || strip.tone === "primary" ? TONE_SURFACE[strip.tone] : "border-border bg-card",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[strip.tone], strip.pulse && "animate-pulse")} />
        <span className="text-foreground font-semibold">{strip.title}</span>
        {strip.details.map((detail) => (
          <span key={detail} className="text-muted-foreground flex items-center gap-2 font-mono">
            <span aria-hidden>·</span>
            {detail}
          </span>
        ))}
      </div>
      {aside &&
        (aside.href ? (
          <Link href={aside.href} className={cn(asideClass, "hover:underline")}>
            {aside.label}
          </Link>
        ) : (
          <span className={asideClass}>{aside.label}</span>
        ))}
    </div>
  );
}
