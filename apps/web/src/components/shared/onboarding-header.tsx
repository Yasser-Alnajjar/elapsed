import { cn } from "@/lib/utils";

const NAV_STEPS = [
  { number: "01", label: "Connect Zendesk" },
  { number: "02", label: "Run 90d Ingestion" },
  { number: "03", label: "Connect Jira" },
  { number: "04", label: "SLA Live" },
] as const;

export function OnboardingHeader({
  currentStep,
}: {
  currentStep: 1 | 2 | 3 | 4 | null;
}) {
  return (
    <header className="fixed top-0 inset-s-0 z-50 w-full bg-surface/90 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
      <div className="flex h-16 w-full items-center justify-center px-6">
        <nav className="hidden items-center gap-2 rounded-lg bg-surface-container-lowest px-1 py-1 md:flex max-w-fit">
          {NAV_STEPS.map((step, index) => {
            const isCurrent = currentStep === index + 1;

            return (
              <div key={step.number} className="flex items-center gap-2">
                {index > 0 && (
                  <div className="h-px w-3 bg-outline-variant/30" />
                )}
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors",
                    isCurrent
                      ? "bg-surface-container-high text-on-surface"
                      : "text-on-surface-variant",
                  )}
                >
                  <span className="font-label-caps text-label-caps text-primary">
                    {step.number}
                  </span>
                  <span className="font-body-sm text-body-sm font-medium">
                    {step.label}
                  </span>
                </span>
              </div>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
