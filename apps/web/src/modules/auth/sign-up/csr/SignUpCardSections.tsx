import { CreditCard, History, ShieldCheck } from "lucide-react";
import { authLabelClass } from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";

/** Trial / transport badges and the page title above the sign-up form. */
export function SignUpIntro() {
  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div
          className={cn(
            authLabelClass,
            "inline-flex items-center gap-1 rounded-[2px] bg-surface-raised px-2 py-1 tracking-wider text-primary",
          )}
        >
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
          <span>14-Day Instant Trial · Zero Write Permissions Required</span>
        </div>

        <div
          className={cn(
            authLabelClass,
            "hidden items-center gap-1 text-foreground-subtle sm:flex",
          )}
        >
          <span>INGRESS_V4_SECURE</span>
          <span>//</span>
          <span className="font-mono text-xs text-primary-fixed-dim">
            TLS 1.3 AES-256
          </span>
        </div>
      </div>

      <div className="mb-6">
        <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.015em] text-foreground">
          Create your Elapsed organization
        </h1>

        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
          Connect your operational systems in minutes. Track every SLA
          commitment with one continuous clock across support, engineering, and
          the systems your teams rely on.
        </p>
      </div>
    </>
  );
}

const BENEFITS = [
  { icon: ShieldCheck, text: "Zero-write access tokens only" },
  { icon: History, text: "90-day backfill audit included" },
  { icon: CreditCard, text: "No credit card required" },
];

/** The three trial promises and the sign-in link under the form. */
export function SignUpFooter() {
  return (
    <>
      <div className="mt-6 grid grid-cols-1 gap-2 pt-4 md:grid-cols-3">
        {BENEFITS.map(({ icon: Icon, text }) => (
          <div
            key={text}
            className="flex items-center gap-2 rounded-[2px] bg-background px-2 py-2"
          >
            <Icon aria-hidden className="size-4 text-success" />

            <span
              className={cn(
                authLabelClass,
                "font-semibold tracking-tight text-muted-foreground",
              )}
            >
              {text}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-1 text-center">
        <span className="text-xs text-muted-foreground">
          Already have an organization workspace?
        </span>

        <a
          href="/sign-in"
          className="ms-1 text-xs font-medium text-primary underline-offset-2 hover:text-primary-fixed-dim hover:underline"
        >
          Sign in →
        </a>
      </div>
    </>
  );
}
