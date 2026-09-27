import type { ReactNode } from "react";
import { OnboardingHeader } from "@/components/shared/onboarding-header";

export function OnboardingShell({
  title,
  description,
  currentStep = null,
  wide = false,
  headerAside,
  children,
}: {
  title: string;
  description?: string;
  /** Highlights the matching tab in the fixed Stitch header nav (1-3), or none on the completion screen. */
  currentStep?: 1 | 2 | 3 | null;
  /** Widens the content column for steps with a multi-column layout (e.g. the Zendesk connector grid). */
  wide?: boolean;
  /** Optional element rendered alongside the title, e.g. an engine-state status chip. */
  headerAside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-surface">
      <OnboardingHeader currentStep={currentStep} />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-grain"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[340px] w-[720px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]"
      />

      <div
        className={`relative mx-auto flex flex-col gap-8 px-6 pt-24 pb-14 ${
          wide ? "max-w-6xl" : "max-w-xl"
        }`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-full space-y-1.5">
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
              {title}
            </h1>
            {description && (
              <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
                {description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {headerAside}
            <a
              href="/dashboard"
              className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Skip to dashboard
            </a>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
