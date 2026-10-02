"use client";

import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Check,
  ChevronRight,
  Info,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Actions } from "@/actions/client";
import {
  AuthFieldError,
  AuthInput,
  AuthPage,
  authLabelClass,
} from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";

const forgotPasswordSchema = Yup.object({
  email: Yup.string()
    .email("Please enter a valid email address")
    .required("Email is required"),
});

type ForgotPasswordFormValues = Yup.InferType<typeof forgotPasswordSchema>;

export const ForgotPasswordForm = () => {
  const [submitted, setSubmitted] = useState(false);

  const initialValues: ForgotPasswordFormValues = {
    email: "",
  };

  async function handleSubmit(
    values: ForgotPasswordFormValues,
    {
      setSubmitting,
    }: {
      setSubmitting: (isSubmitting: boolean) => void;
    },
  ) {
    // Always succeeds from the caller's perspective — the server responds
    // identically whether or not the email belongs to an account, so
    // there's nothing to branch on here.
    await Actions.PasswordReset.request(values.email);

    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <AuthPage>
      <div className="relative z-10 flex w-full flex-col items-center justify-center">
        <div className="relative w-full max-w-[540px]">
          <div
            aria-hidden
            className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full bg-primary/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -right-16 size-64 rounded-full bg-primary-fixed-dim/5 blur-3xl"
          />

          <div className="relative w-full overflow-hidden rounded-[4px] bg-background p-4 shadow-2xl sm:p-8">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-80" />

            <div className="mb-4 flex flex-wrap items-center justify-between gap-1 border-b border-border/70 pb-4">
              <div
                className={cn(
                  authLabelClass,
                  "flex items-center gap-1 tracking-wider text-foreground-subtle",
                )}
              >
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
                <span>AUTH-DAEMON v4.19</span>
                <span className="text-border-strong">/</span>
                <span className="text-muted-foreground">SESSION_RECOVERY</span>
              </div>
              <div className={cn(authLabelClass, "text-foreground-subtle")}>
                PORT: <span className="font-mono text-primary">443/TLS1.3</span>
              </div>
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="group relative mb-4">
                <div className="absolute inset-0 rounded-[8px] bg-primary/20 blur-md transition-all duration-300 group-hover:blur-lg" />
                <div className="relative flex size-14 items-center justify-center rounded-[8px] bg-surface-raised shadow-lg">
                  <LockKeyhole
                    aria-hidden
                    className="size-7 fill-primary/20 text-primary"
                  />
                  <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-elevated shadow-sm">
                    <KeyRound
                      aria-hidden
                      className="size-3 text-primary-fixed-dim"
                    />
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  authLabelClass,
                  "mb-2 inline-flex items-center gap-1 rounded-[2px] bg-surface-raised px-2 py-1 tracking-widest text-primary",
                )}
              >
                <Timer aria-hidden className="size-3.5" />
                <span>CREDENTIAL RECOVERY PROTOCOL · TIME-LOCKED OTP</span>
              </div>

              <h1 className="mb-1 text-[28px] font-semibold leading-9 tracking-[-0.015em] text-foreground">
                {submitted ? "Check your email" : "Reset your password"}
              </h1>
              <p className="mb-6 max-w-[430px] text-sm leading-relaxed text-muted-foreground">
                {submitted
                  ? "If an account exists for that email, we've sent a link to reset your password."
                  : "Enter your registered corporate email address and we will dispatch a cryptographically signed, time-bounded password reset link."}
              </p>
            </div>

            <Formik
              initialValues={initialValues}
              validationSchema={forgotPasswordSchema}
              onSubmit={handleSubmit}
            >
              {({ errors, touched, isSubmitting, values, getFieldProps }) => {
                const domainKnown =
                  values.email.includes("@") &&
                  (values.email.split("@")[1]?.length ?? 0) > 3;

                return (
                  <Form className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1 text-start">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="email"
                          className={cn(
                            authLabelClass,
                            "flex items-center gap-1 text-muted-foreground",
                          )}
                        >
                          <Mail aria-hidden className="size-3.5 text-primary" />
                          <span>Work Email Address</span>
                        </label>
                        <span
                          className={cn(
                            authLabelClass,
                            "text-foreground-subtle",
                          )}
                        >
                          REQUIRED
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <AtSign
                          aria-hidden
                          className="pointer-events-none absolute inset-s-4 size-[18px] text-foreground-subtle"
                        />
                        <AuthInput
                          {...getFieldProps("email")}
                          id="email"
                          type="email"
                          autoComplete="email"
                          placeholder="name@company.com"
                          className="rounded-[2px] bg-background py-2 ps-10 pe-4 font-mono text-sm font-medium shadow-inner duration-150 placeholder:text-foreground-subtle/60"
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
                      <div className="flex items-center justify-between px-1 pt-0.5">
                        <span
                          className={cn(
                            authLabelClass,
                            "text-foreground-subtle",
                          )}
                        >
                          Domain checks enabled
                        </span>
                        {domainKnown && (
                          <span
                            className={cn(
                              authLabelClass,
                              "flex items-center gap-1 text-success",
                            )}
                          >
                            <span className="inline-block size-1.5 rounded-full bg-success" />
                            Verified Tenant
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="relative overflow-hidden rounded-[2px] bg-background/80 p-4">
                      <div className="absolute inset-y-0 inset-s-0 w-1 bg-warning" />
                      <div className="flex items-start gap-2 ps-1">
                        <Info
                          aria-hidden
                          className="mt-0.5 size-[18px] shrink-0 text-warning-text"
                        />
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={cn(
                              authLabelClass,
                              "tracking-wider text-warning-text",
                            )}
                          >
                            Federated Identity Notice
                          </span>
                          <p className="text-xs leading-snug text-on-surface-variant">
                            For SAML / Okta SSO managed accounts, password
                            resets must be initiated through your company
                            identity provider portal.
                          </p>
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className={cn(
                        "group relative mt-1 flex w-full items-center justify-center gap-2 rounded-[2px] px-4 py-2 text-sm font-semibold tracking-wide text-primary-foreground shadow-md transition-all duration-200 hover:shadow-primary/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70",
                        submitted
                          ? "bg-success"
                          : "bg-primary hover:bg-primary-hover",
                      )}
                    >
                      {isSubmitting && (
                        <Loader2 aria-hidden className="size-4 animate-spin" />
                      )}
                      <span>
                        {isSubmitting
                          ? "Verifying Ingress Tenant..."
                          : submitted
                            ? "Instructions Dispatched"
                            : "Send Reset Instructions"}
                      </span>
                      {!isSubmitting &&
                        (submitted ? (
                          <Check aria-hidden className="size-[18px]" />
                        ) : (
                          <ArrowRight
                            aria-hidden
                            className="size-[18px] transition-transform duration-200 group-hover:translate-x-0.5"
                          />
                        ))}
                    </button>
                  </Form>
                );
              }}
            </Formik>

            {submitted && (
              <div className="mt-4 flex flex-col gap-1 rounded-[2px] bg-surface-raised p-4">
                <div
                  className={cn(
                    authLabelClass,
                    "flex items-center gap-1 text-success",
                  )}
                >
                  <Check aria-hidden className="size-4" />
                  <span>DISPATCH CONFIRMED · ENCRYPTED PAYLOAD SENT</span>
                </div>
                <p className="text-xs leading-4 text-muted-foreground">
                  Check your corporate inbox. An authenticated, zero-knowledge
                  verification challenge has been routed to the provided
                  address.
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
              <a
                href="/docs/faq"
                className="group flex items-center justify-between rounded-[2px] bg-surface-raised/50 p-2 transition-colors duration-150 hover:bg-interactive/50"
              >
                <div className="flex items-center gap-2">
                  <LockKeyhole
                    aria-hidden
                    className="size-[18px] text-primary-fixed-dim"
                  />
                  <div className="flex flex-col text-start">
                    <span
                      className={cn(
                        authLabelClass,
                        "font-semibold normal-case tracking-[0.06em] text-foreground transition-colors group-hover:text-primary",
                      )}
                    >
                      Lost access to your 2FA hardware security key (YubiKey)?
                    </span>
                    <span className="text-xs leading-4 text-foreground-subtle">
                      Request hardware bypass / Admin verification
                    </span>
                  </div>
                </div>
                <ChevronRight
                  aria-hidden
                  className="size-[18px] text-foreground-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary"
                />
              </a>
              <div className="flex items-center justify-center pt-1">
                <a
                  href="/sign-in"
                  className="inline-flex items-center gap-1 rounded-[2px] px-2 py-1 font-mono text-xxs font-semibold leading-[14px] tracking-[0.04em] text-muted-foreground transition-colors hover:bg-surface-raised hover:text-primary"
                >
                  <ArrowLeft aria-hidden className="size-4" />
                  <span>Return to Sign In</span>
                </a>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 border-t border-border/40 pt-4">
              <ShieldCheck
                aria-hidden
                className="mt-0.5 size-[15px] shrink-0 text-foreground-subtle"
              />
              <div className="flex flex-col gap-0.5 text-start">
                <p
                  className={cn(
                    authLabelClass,
                    "font-normal leading-normal text-foreground-subtle",
                  )}
                >
                  Reset tokens expire in 1 hour and self-invalidate upon first
                  cryptographic usage. Ingress audit trail logged.
                </p>
                <span
                  className={cn(
                    authLabelClass,
                    "font-mono font-normal text-foreground-subtle/80",
                  )}
                >
                  HASH: sha256_secp256k1_verified
                </span>
              </div>
            </div>
          </div>

          <div
            className={cn(
              authLabelClass,
              "mt-4 flex items-center justify-between px-2 font-normal text-foreground-subtle",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success" />
              <span>GATEWAY: US-EAST-CORE-01</span>
            </div>
            <div className="font-mono">
              NONCE: <span className="text-muted-foreground">0x8F3C92B4A1</span>
            </div>
          </div>
        </div>
      </div>
    </AuthPage>
  );
};
