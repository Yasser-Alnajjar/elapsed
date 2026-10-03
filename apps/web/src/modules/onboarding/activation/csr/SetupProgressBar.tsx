import { BadgeCheck, Check } from "lucide-react";

export interface CompletedStep {
  number: string;
  label: string;
  detail: string;
  /** A step that was optional and skipped, shown as open instead of done. Defaults to done. */
  pending?: boolean;
}

/** The 4-step completion strip. Steps 1, 2 and 4 are always done by the time this screen renders (`getActivationData` redirects back to `/onboarding` otherwise); step 3, the work tracker, is optional and shows as open without one (N5.2). */
function CompletionStrip({ steps }: { steps: CompletedStep[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;

        return (
          <div
            key={step.number}
            className={`flex items-start gap-3 rounded-lg p-3.5 ${
              isLast
                ? "bg-tertiary/10 shadow-[0_0_15px_color-mix(in_srgb,var(--success)_12%,transparent)]"
                : "bg-surface-container-low"
            }`}
          >
            <div
              className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                step.pending
                  ? "bg-surface-container-high text-on-surface-variant"
                  : isLast
                    ? "bg-tertiary text-on-tertiary"
                    : "bg-tertiary/20 text-tertiary"
              }`}
            >
              {step.pending ? (
                <span className="size-1.5 rounded-full bg-current" />
              ) : (
                <Check className="size-3.5 shrink-0" />
              )}
            </div>
            <div className="min-w-0">
              <span className="font-body-sm text-body-sm font-medium text-on-surface-variant">
                {step.number}
              </span>
              <div className="font-headline-sm truncate text-[13px] font-semibold text-on-surface">
                {step.label}
              </div>
              <div className="font-code-audit text-code-audit mt-0.5 text-on-surface-variant/80">
                {step.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The mockup's "Setup Progress" wizard bar: an ambient-glow card wrapping the
 * step grid, with a "Step 4 of 4" pill and a live-tracking pulse badge — the
 * same "live telemetry" idiom `OnboardingHeader` already uses elsewhere.
 */
export function SetupProgressBar({ steps }: { steps: CompletedStep[] }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 size-80 rounded-full bg-tertiary/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-20 size-80 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-6 p-4 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BadgeCheck className="size-[22px] shrink-0" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-label-caps text-label-caps uppercase tracking-wider text-on-surface-variant">
                  Setup progress
                </span>
                <span className="font-label-caps text-label-caps rounded bg-tertiary/10 px-2 py-0.5 uppercase text-tertiary">
                  Step 4 of 4
                </span>
              </div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface">
                Zero-config onboarding &amp; verification complete
              </h2>
            </div>
          </div>

          <div className="inline-flex items-center gap-2.5 rounded-lg bg-surface-container-low px-3 py-1.5 shadow-inner">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-tertiary opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-tertiary" />
            </span>
            <span className="font-code-audit text-code-audit font-semibold uppercase tracking-wider text-tertiary">
              Live tracking active
            </span>
          </div>
        </div>

        <CompletionStrip steps={steps} />
      </div>
    </div>
  );
}
