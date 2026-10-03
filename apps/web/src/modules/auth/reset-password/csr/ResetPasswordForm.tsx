"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  History,
  Loader2,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Formik, Form } from "formik";
import { Actions } from "@/actions/client";
import {
  AuthAlert,
  AuthPage,
  authButtonClass,
  authLabelClass,
} from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";
import { EntropyPanel } from "./EntropyPanel";
import { NewPasswordFields } from "./NewPasswordFields";
import { ResetLinkStatusCard } from "./ResetLinkStatusCard";
import { ResetPasswordIntro } from "./ResetPasswordIntro";
import {
  cardClass,
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from "./reset-password-schema";

const initialValues: ResetPasswordFormValues = {
  password: "",
  confirmPassword: "",
};

export const ResetPasswordForm = () => {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    return <ResetLinkStatusCard submitted={submitted} />;
  }

  return (
    <AuthPage>
      <div className="relative z-10 mx-auto flex w-full max-w-xl flex-col py-4">
        <div className={cardClass}>
          <div className="pointer-events-none absolute -top-24 left-1/2 h-32 w-80 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

          <ResetPasswordIntro token={token} />

          <Formik
            initialValues={initialValues}
            validationSchema={resetPasswordSchema}
            onSubmit={handleSubmit}
          >
            {({ isSubmitting, values }) => (
              <Form className="space-y-6">
                <NewPasswordFields />

                <EntropyPanel password={values.password} />

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
                      className="inline-flex items-center gap-1 py-1 font-mono text-xxs font-semibold leading-[14px] tracking-[0.04em] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ArrowLeft aria-hidden className="size-[15px]" />
                      <span>Cancel and return to Sign In</span>
                    </a>
                  </div>
                </div>
              </Form>
            )}
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
