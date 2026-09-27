"use client";

import {
  AlertCircle,
  ArrowRight,
  ArrowRightToLine,
  Building2,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  LayoutGrid,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Actions } from "@/actions/client";
import {
  AuthAlert,
  AuthFieldError,
  AuthInput,
  AuthPage,
  authButtonClass,
  authLabelClass,
} from "@/components/shared/auth-shell";
import {
  formatCooldownClock,
  formatCooldownSentence,
} from "@/lib/auth-rate-limit";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

const signInSchema = Yup.object({
  email: Yup.string()
    .email("Please enter a valid email address")
    .required("Email is required"),
  password: Yup.string().required("Password is required"),
});

type SignInFormValues = Yup.InferType<typeof signInSchema>;

const fieldClass =
  "h-10 rounded-[2px] border border-border bg-surface-container-lowest pl-9 text-sm focus:border-sky-500";

export const SignInForm = () => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // Seconds remaining in a server-imposed cooldown.
  const [cooldownSeconds, setCooldownSeconds] = useState<number | null>(null);
  const [cooldownReason, setCooldownReason] = useState<
    "RATE_LIMITED" | "AUTH_THROTTLED" | null
  >(null);

  useEffect(() => {
    if (cooldownSeconds === null) return;

    if (cooldownSeconds <= 0) {
      setCooldownSeconds(null);
      setCooldownReason(null);
      return;
    }

    const timer = setTimeout(
      () => setCooldownSeconds((seconds) => (seconds ?? 1) - 1),
      1000,
    );

    return () => clearTimeout(timer);
  }, [cooldownSeconds]);

  const inCooldown = cooldownSeconds !== null && cooldownSeconds > 0;

  const initialValues: SignInFormValues = {
    email: "",
    password: "",
  };

  async function handleSubmit(
    values: SignInFormValues,
    {
      setSubmitting: setFormikSubmitting,
    }: {
      setSubmitting: (isSubmitting: boolean) => void;
    },
  ) {
    if (inCooldown) {
      setFormikSubmitting(false);
      return;
    }

    setError(null);

    const result = await Actions.Auth.signIn(values.email, values.password);

    setFormikSubmitting(false);

    if (!result.ok) {
      if (
        (result.error === "RATE_LIMITED" ||
          result.error === "AUTH_THROTTLED") &&
        "retryAfterSeconds" in result
      ) {
        setCooldownReason(result.error);
        setCooldownSeconds(result.retryAfterSeconds);
      } else {
        setError("Incorrect email or password");
      }

      return;
    }

    router.push("/dashboard");
  }

  const altSsoClass =
    "flex h-9 cursor-not-allowed items-center justify-center gap-2 rounded-[2px] border border-border bg-surface-raised px-3 text-xs text-foreground transition-all hover:border-border-strong hover:bg-interactive";

  return (
    <AuthPage>
      <div className="relative z-10 flex w-full flex-col items-center justify-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 size-120 rounded-full bg-sky-500/10 blur-[130px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 size-90 rounded-full bg-primary-fixed-dim/5 blur-[100px]"
        />

        <div className="relative z-10 w-full max-w-115">
          <div className="rounded-lg bg-linear-to-b from-primary/30 via-border-strong to-border p-px shadow-[0_24px_50px_-12px_rgba(6,10,18,0.95)]">
            <div className="flex flex-col gap-4 rounded-[calc(0.5rem-1px)] bg-background p-6">
              <div className="flex flex-col items-center gap-1 text-center">
                <h1 className="text-[28px] font-bold leading-9 tracking-[-0.015em] text-foreground">
                  Sign in to Elapsed
                </h1>
                <p className="max-w-85 text-sm leading-5 text-muted-foreground">
                  Sign in with your workspace credentials to continue.
                </p>
              </div>
              {/* 
              <div className="mt-1 flex flex-col gap-1">
                <button
                  type="button"
                  aria-disabled
                  title="SSO is not configured for this workspace"
                  className="group relative flex h-10 w-full cursor-not-allowed items-center justify-between rounded-[2px] border border-border bg-surface-raised px-3.5 transition-all duration-150 hover:border-primary/50 hover:bg-interactive"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-5 items-center justify-center rounded-[2px] bg-sky-500/20 text-primary">
                      <KeyRound aria-hidden className="size-3.75" />
                    </span>
                    <span className="font-mono text-sm font-medium text-foreground">
                      Continue with Okta / SAML SSO
                    </span>
                  </div>
                  <span
                    className={cn(
                      authLabelClass,
                      "rounded-[2px] border border-border bg-zinc-800 px-1.5 py-0.5 text-primary-fixed-dim group-hover:border-primary/30",
                    )}
                  >
                    DEFAULT
                  </span>
                </button>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    aria-disabled
                    title="SSO is not configured for this workspace"
                    className={altSsoClass}
                  >
                    <Building2
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                    <span>Azure AD</span>
                  </button>
                  <button
                    type="button"
                    aria-disabled
                    title="SSO is not configured for this workspace"
                    className={altSsoClass}
                  >
                    <LayoutGrid
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                    <span>Google Workspace</span>
                  </button>
                </div>
              </div>

              <div className="relative my-0.5 flex items-center justify-center">
                <div className="w-full border-t border-border" />
                <span
                  className={cn(
                    authLabelClass,
                    "absolute bg-background px-2.5 tracking-widest text-foreground-subtle",
                  )}
                >
                  OR CONTINUE WITH CORPORATE EMAIL
                </span>
              </div> */}

              <Formik
                initialValues={initialValues}
                validationSchema={signInSchema}
                onSubmit={handleSubmit}
              >
                {({ errors, touched, isSubmitting, getFieldProps }) => (
                  <Form className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="email"
                        className={cn(
                          authLabelClass,
                          "flex items-center justify-between text-muted-foreground",
                        )}
                      >
                        <span>Corporate Identity / Email</span>
                      </label>
                      <div className="relative flex items-center">
                        <Mail
                          aria-hidden
                          className="pointer-events-none absolute left-3 size-4.25 text-foreground-subtle"
                        />
                        <AuthInput
                          {...getFieldProps("email")}
                          id="email"
                          type="email"
                          autoComplete="email"
                          placeholder="name@company.com"
                          className={cn(fieldClass, "pr-3.5")}
                          aria-invalid={Boolean(touched.email && errors.email)}
                          aria-describedby={
                            touched.email && errors.email
                              ? "email-error"
                              : undefined
                          }
                        />
                      </div>
                      <AuthFieldError
                        id="email-error"
                        message={touched.email ? errors.email : undefined}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="password"
                          className={cn(
                            authLabelClass,
                            "text-muted-foreground",
                          )}
                        >
                          Password
                        </label>
                        <a
                          href="/forgot-password"
                          className="text-xs text-primary transition-colors hover:text-primary-fixed-dim hover:underline"
                        >
                          Forgot password?
                        </a>
                      </div>
                      <div className="relative flex items-center">
                        <Lock
                          aria-hidden
                          className="pointer-events-none absolute left-3 size-4.25 text-foreground-subtle"
                        />
                        <AuthInput
                          {...getFieldProps("password")}
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="••••••••••••••••"
                          className={cn(
                            fieldClass,
                            "pr-10 font-mono text-base font-bold tracking-widest",
                          )}
                          aria-invalid={Boolean(
                            touched.password && errors.password,
                          )}
                          aria-describedby={
                            touched.password && errors.password
                              ? "password-error"
                              : undefined
                          }
                        />
                        <button
                          type="button"
                          aria-label="Toggle password visibility"
                          onClick={() => setShowPassword((shown) => !shown)}
                          className="absolute right-2.5 flex items-center p-1 text-foreground-subtle transition-colors hover:text-foreground"
                        >
                          {showPassword ? (
                            <EyeOff aria-hidden className="size-4.25" />
                          ) : (
                            <Eye aria-hidden className="size-4.25" />
                          )}
                        </button>
                      </div>
                      <AuthFieldError
                        id="password-error"
                        message={touched.password ? errors.password : undefined}
                      />
                    </div>

                    <div className="flex items-start gap-2.5 pt-1">
                      <Checkbox
                        id="session-bind"
                        defaultChecked
                        className="mt-0.5 size-4 rounded"
                      />

                      <label
                        htmlFor="session-bind"
                        className="cursor-pointer select-none text-xs leading-4 text-muted-foreground"
                      >
                        Keep session active for 12 hours{" "}
                        <span className="font-mono text-xxs text-foreground-subtle">
                          (Hardware key bound)
                        </span>
                      </label>
                    </div>

                    {error && (
                      <AuthAlert
                        tone="danger"
                        icon={<AlertCircle aria-hidden />}
                      >
                        {error}
                      </AuthAlert>
                    )}

                    {inCooldown && (
                      <AuthAlert tone="warning" icon={<Clock aria-hidden />}>
                        {cooldownReason === "AUTH_THROTTLED"
                          ? "Too many failed login attempts."
                          : "Too many login attempts."}{" "}
                        Please try again in{" "}
                        {formatCooldownSentence(cooldownSeconds ?? 0)}.
                      </AuthAlert>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting || inCooldown}
                      className={cn(
                        authButtonClass,
                        "mt-1 h-10 text-sm text-primary-foreground hover:shadow-[0_0_20px_rgba(14,165,233,0.45)]",
                      )}
                    >
                      {isSubmitting && (
                        <Loader2
                          aria-hidden
                          className="size-4.5 animate-spin"
                        />
                      )}
                      <span>
                        {inCooldown
                          ? `Try again in ${formatCooldownClock(cooldownSeconds ?? 0)}`
                          : isSubmitting
                            ? "Signing in…"
                            : "Sign In to Workspace"}
                      </span>
                      {!isSubmitting && (
                        <ArrowRight
                          aria-hidden
                          className="size-4.5 transition-transform duration-150 group-hover:translate-x-0.5"
                        />
                      )}
                    </button>
                  </Form>
                )}
              </Formik>

              <div className="flex items-center justify-center gap-1.5 rounded-[2px] border border-border bg-surface-container-lowest/60 px-2 py-1 text-center">
                <ShieldCheck aria-hidden className="size-3.5 text-primary" />
                <span className={cn(authLabelClass, "text-foreground-subtle")}>
                  Protected by AES-256-GCM Session Tokens &amp; FIDO2 WebAuthn
                </span>
              </div>

              <div className="border-t border-border/80 pt-2 text-center">
                <p className="text-xs text-muted-foreground">
                  Don&apos;t have an organization workspace?{" "}
                  <a
                    href="/sign-up"
                    className="inline-flex items-center gap-0.5 font-medium text-primary transition-colors hover:text-primary-fixed-dim"
                  >
                    Start 14-day zero-risk trial
                    <ArrowRightToLine aria-hidden className="size-3.25" />
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthPage>
  );
};
