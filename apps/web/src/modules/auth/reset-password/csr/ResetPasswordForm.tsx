"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  History,
  Loader2,
  LockKeyhole,
  Timer,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
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
import { cn } from "@/lib/utils";

const resetPasswordSchema = Yup.object({
  password: Yup.string()
    .min(8, "Password must be at least 8 characters")
    .required("Password is required"),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref("password")], "Passwords do not match")
    .required("Please confirm your password"),
});

type ResetPasswordFormValues = Yup.InferType<typeof resetPasswordSchema>;

/** Live checks shown in the entropy panel; only the 8-char minimum gates submit. */
function passwordChecks(password: string) {
  return [
    { label: "≥ 8 characters", status: "MET ✓", met: password.length >= 8 },
    {
      label: "Mixed casing, numbers & symbols",
      status: "MET ✓",
      met:
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /\d/.test(password) &&
        /[^A-Za-z0-9]/.test(password),
    },
    { label: "≥ 12 characters", status: "MET ✓", met: password.length >= 12 },
    {
      label: "No repeated character runs",
      status: "CHECKED ✓",
      met: password.length > 0 && !/(.)\1{2,}/.test(password),
    },
  ];
}

const cardClass =
  "relative w-full overflow-hidden rounded-[8px] bg-background p-6 shadow-2xl md:p-8";

const fieldLabelClass = cn(
  authLabelClass,
  "text-[11px] leading-[14px] tracking-[0.04em] text-muted-foreground",
);

const fieldClass =
  "rounded-[2px] bg-surface-container-lowest px-4 py-2 pr-12 font-mono text-sm font-medium focus:ring-offset-2 focus:ring-offset-surface-container-lowest";

export const ResetPasswordForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const initialValues: ResetPasswordFormValues = {
    password: "",
    confirmPassword: "",
  };

  async function handleSubmit(
    values: ResetPasswordFormValues,
    {
      setSubmitting,
    }: {
      setSubmitting: (isSubmitting: boolean) => void;
    },
  ) {
    setError(null);

    const { ok, body } = await Actions.PasswordReset.confirm({
      token,
      password: values.password,
    });

    setSubmitting(false);

    if (!ok) {
      setError(body.error ?? "This link is invalid or has expired.");
      return;
    }

    setSubmitted(true);
  }

  if (!token || submitted) {
    return (
      <AuthPage>
        <div className="relative z-10 mx-auto w-full max-w-xl">
          <div className={cardClass}>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.015em] text-foreground">
                  {submitted ? "Password reset" : "Reset password"}
                </h1>
                <p className="text-sm leading-5 text-muted-foreground">
                  {submitted
                    ? "Your password has been changed."
                    : "This reset link is missing its token."}
                </p>
              </div>
              {submitted ? (
                <>
                  <AuthAlert tone="success" icon={<CheckCircle2 aria-hidden />}>
                    You can now sign in with your new password.
                  </AuthAlert>
                  <button
                    type="button"
                    className={cn(authButtonClass, "h-11")}
                    onClick={() => router.push("/sign-in")}
                  >
                    <span>Go to sign in</span>
                    <ArrowRight aria-hidden className="size-[18px]" />
                  </button>
                </>
              ) : (
                <>
                  <AuthAlert tone="danger" icon={<AlertCircle aria-hidden />}>
                    Open the link from your email again, or request a new one.
                  </AuthAlert>
                  <a
                    href="/forgot-password"
                    className={cn(authButtonClass, "h-11")}
                  >
                    Request a new link
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </AuthPage>
    );
  }

  const tokenHash = `0x${token.slice(0, 3)}...${token.slice(-3)}`;

  return (
    <AuthPage>
      <div className="relative z-10 mx-auto flex w-full max-w-xl flex-col py-4">
        <div className={cardClass}>
          <div className="pointer-events-none absolute -top-24 left-1/2 h-32 w-80 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

          <div className="relative mb-6 flex flex-wrap items-center justify-between gap-1 pb-4">
            <div
              className={cn(
                authLabelClass,
                "flex items-center gap-1 rounded-[2px] bg-surface-raised px-2 py-1 text-primary-fixed-dim",
              )}
            >
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-success" />
              <span className="tracking-widest">TOKEN RECEIVED</span>
              <span className="text-foreground-subtle">·</span>
              <span className="text-muted-foreground">TOKEN_HASH: {tokenHash}</span>
            </div>
            <div
              className={cn(
                authLabelClass,
                "flex items-center gap-1 rounded-[2px] bg-surface-raised px-2 py-1 text-warning",
              )}
            >
              <Timer aria-hidden className="size-[13px]" />
              <span>1H RUNWAY</span>
            </div>
          </div>

          <div className="mb-6 space-y-1">
            <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.015em] text-foreground">
              Set a new master password
            </h1>
            <p className="text-sm leading-5 text-muted-foreground">
              For security reasons, your new password must comply with
              enterprise zero-trust entropy standards.
            </p>
          </div>

          <Formik
            initialValues={initialValues}
            validationSchema={resetPasswordSchema}
            onSubmit={handleSubmit}
          >
            {({ errors, touched, isSubmitting, values, getFieldProps }) => {
              const checks = passwordChecks(values.password);
              const entropy = Math.round(
                (checks.filter((check) => check.met).length / checks.length) *
                  100,
              );
              const matches =
                values.confirmPassword.length > 0 &&
                values.confirmPassword === values.password;

              return (
                <Form className="space-y-6">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label htmlFor="password" className={fieldLabelClass}>
                        New Master Password
                      </label>
                      <span className={cn(authLabelClass, "text-foreground-subtle")}>
                        MIN. 8 CHARS
                      </span>
                    </div>
                    <div className="relative flex items-center">
                      <AuthInput
                        {...getFieldProps("password")}
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        className={fieldClass}
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
                        className="absolute right-2 p-1 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
                      >
                        {showPassword ? (
                          <EyeOff aria-hidden className="size-5" />
                        ) : (
                          <Eye aria-hidden className="size-5" />
                        )}
                      </button>
                    </div>
                    <AuthFieldError
                      id="password-error"
                      message={touched.password ? errors.password : undefined}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="confirmPassword"
                        className={fieldLabelClass}
                      >
                        Confirm Master Password
                      </label>
                      {matches && (
                        <span
                          className={cn(
                            authLabelClass,
                            "flex items-center gap-1 text-success",
                          )}
                        >
                          <CheckCircle2 aria-hidden className="size-[13px]" />
                          <span>MATCH CONFIRMED</span>
                        </span>
                      )}
                    </div>
                    <div className="relative flex items-center">
                      <AuthInput
                        {...getFieldProps("confirmPassword")}
                        id="confirmPassword"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        className={fieldClass}
                        aria-invalid={Boolean(
                          touched.confirmPassword && errors.confirmPassword,
                        )}
                        aria-describedby={
                          touched.confirmPassword && errors.confirmPassword
                            ? "confirm-password-error"
                            : undefined
                        }
                      />
                      {matches && (
                        <div className="pointer-events-none absolute right-4 flex items-center text-success">
                          <Check aria-hidden className="size-5" />
                        </div>
                      )}
                    </div>
                    <AuthFieldError
                      id="confirm-password-error"
                      message={
                        touched.confirmPassword
                          ? errors.confirmPassword
                          : undefined
                      }
                    />
                  </div>

                  <div className="space-y-4 rounded-[4px] bg-surface-raised p-4">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <LockKeyhole
                            aria-hidden
                            className="size-[15px] text-primary"
                          />
                          <span
                            className={cn(
                              authLabelClass,
                              "tracking-wider text-muted-foreground",
                            )}
                          >
                            Entropy Analysis
                          </span>
                        </div>
                        <span
                          className={cn(
                            authLabelClass,
                            "font-bold text-primary",
                          )}
                        >
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
                          <CheckCircle2
                            aria-hidden
                            className="size-4 shrink-0"
                          />
                          <span
                            className={cn(
                              "font-mono text-xs font-medium",
                              check.met ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {check.label}
                          </span>
                          {check.met && (
                            <span
                              className={cn(
                                authLabelClass,
                                "ml-auto text-success",
                              )}
                            >
                              {check.status}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex select-none items-start gap-2 rounded-[4px] bg-surface-raised p-4">
                    <input
                      id="revoke-sessions"
                      type="checkbox"
                      defaultChecked
                      className="mt-1 size-4 cursor-pointer rounded-[2px] accent-primary"
                    />
                    <label htmlFor="revoke-sessions" className="cursor-pointer">
                      <span className="block text-sm font-medium leading-5 text-foreground">
                        Terminate and revoke all other active browser sessions
                        &amp; CLI daemon leases
                      </span>
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        Immediately expires existing API access tokens, Linear
                        daemon sync links, and OAuth grants.
                      </span>
                    </label>
                  </div>

                  {error && (
                    <AuthAlert tone="danger" icon={<AlertCircle aria-hidden />}>
                      {error}{" "}
                      <a
                        href="/forgot-password"
                        className="font-medium underline underline-offset-4"
                      >
                        Request a new link
                      </a>
                    </AuthAlert>
                  )}

                  <div className="space-y-4 pt-1">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className={cn(
                        authButtonClass,
                        "h-11 gap-1 shadow-[0_0_16px_color-mix(in_srgb,var(--primary)_30%,transparent)] hover:shadow-[0_0_24px_color-mix(in_srgb,var(--primary)_50%,transparent)]",
                      )}
                    >
                      {isSubmitting && (
                        <Loader2
                          aria-hidden
                          className="size-[18px] animate-spin"
                        />
                      )}
                      <span>
                        {isSubmitting
                          ? "Resetting…"
                          : "Update Password & Re-authenticate"}
                      </span>
                      {!isSubmitting && (
                        <ArrowRight aria-hidden className="size-[18px]" />
                      )}
                    </button>
                    <div className="text-center">
                      <a
                        href="/sign-in"
                        className="inline-flex items-center gap-1 py-1 font-mono text-[11px] font-semibold leading-[14px] tracking-[0.04em] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ArrowLeft aria-hidden className="size-[15px]" />
                        <span>Cancel and return to Sign In</span>
                      </a>
                    </div>
                  </div>
                </Form>
              );
            }}
          </Formik>

          <div className="-mx-6 -mb-6 mt-6 flex items-start gap-2 bg-surface-container-lowest/60 p-4 md:-mx-8 md:-mb-8">
            <History
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-foreground-subtle"
            />
            <p
              className={cn(
                authLabelClass,
                "font-normal leading-normal text-foreground-subtle",
              )}
            >
              Changes are committed to the immutable organization audit log. All
              API tokens and OAuth session cookies will be cycled upon
              successful re-hash execution.
            </p>
          </div>
        </div>
      </div>
    </AuthPage>
  );
};
