import { CheckCircle2, LockKeyhole } from "lucide-react";
import { authLabelClass } from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";
import { passwordChecks, passwordEntropy } from "./password-checks";

/** Live entropy meter and per-check readout for the password being typed. */
export function EntropyPanel({ password }: { password: string }) {
  const checks = passwordChecks(password);
  const entropy = passwordEntropy(checks);

  return (
    <div className="space-y-4 rounded-[4px] bg-surface-raised p-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <LockKeyhole aria-hidden className="size-[15px] text-primary" />
            <span
              className={cn(
                authLabelClass,
                "tracking-wider text-muted-foreground",
              )}
            >
              Entropy Analysis
            </span>
          </div>
          <span className={cn(authLabelClass, "font-bold text-primary")}>
            ENTROPY: {entropy}% ·{" "}
            {entropy >= 75
              ? "HIGH SECURITY"
              : entropy >= 50
                ? "MODERATE"
                : "LOW"}
          </span>
        </div>
        <div className="grid h-1.5 w-full grid-cols-4 gap-1.5">
          {checks.map((check, index) => (
            <div
              key={check.label}
              className={cn(
                "rounded-[1px]",
                check.met
                  ? index === checks.length - 1
                    ? "bg-success shadow-[0_0_8px_color-mix(in_srgb,var(--success)_50%,transparent)]"
                    : "bg-primary shadow-[0_0_8px_color-mix(in_srgb,var(--primary)_50%,transparent)]"
                  : "bg-border-strong",
              )}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-2 pt-1 sm:grid-cols-2">
        {checks.map((check) => (
          <div
            key={check.label}
            className={cn(
              "flex items-center gap-1",
              check.met ? "text-success" : "text-foreground-subtle",
            )}
          >
            <CheckCircle2 aria-hidden className="size-4 shrink-0" />
            <span
              className={cn(
                "font-mono text-xs font-medium",
                check.met ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {check.label}
            </span>
            {check.met && (
              <span className={cn(authLabelClass, "ms-auto text-success")}>
                {check.status}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
