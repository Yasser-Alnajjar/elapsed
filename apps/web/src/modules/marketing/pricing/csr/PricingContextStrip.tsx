import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TONE_DOT, TONE_SURFACE, TONE_TEXT } from "@/lib/status-styles";
import type { PricingContextStrip as Strip } from "@/lib/types/pricing";
import { cn } from "@/lib/utils";

/** Where the signed-in organization stands: trial, plan, scheduled change, payment, or read-only. */
export function PricingContextStrip({ strip }: { strip: Strip }) {
  const emphasised = strip.tone === "warning" || strip.tone === "danger";
  const aside = strip.aside;
  const asideClass = cn("flex shrink-0 items-center gap-0.5 font-mono text-xs font-medium", aside?.tone ? TONE_TEXT[aside.tone] : "text-muted-foreground");

  return (
    <div
      role="status"
      className={cn(
        "flex w-full flex-col justify-between gap-2 rounded border p-2 text-left transition-all sm:flex-row sm:items-center sm:p-4",
        emphasised || strip.tone === "primary" ? TONE_SURFACE[strip.tone] : "bg-card border-border",
      )}
    >
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full sm:mt-0", TONE_DOT[strip.tone], strip.pulse && "animate-pulse")} />
        <div className="flex min-w-0 flex-col">
          <span className="text-xl leading-none font-semibold text-foreground">{strip.title}</span>
          {strip.details.length > 0 && <span className="text-muted-foreground mt-1.5 font-mono text-xs">{strip.details.join(" · ")}</span>}
        </div>
      </div>
      {aside &&
        (aside.href ? (
          <Link href={aside.href} className={cn(asideClass, "self-end underline underline-offset-4 hover:opacity-80 sm:self-center")}>
            <span>{aside.label}</span>
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        ) : (
          <span className={cn(asideClass, "self-end sm:self-center")}>{aside.label}</span>
        ))}
    </div>
  );
}
