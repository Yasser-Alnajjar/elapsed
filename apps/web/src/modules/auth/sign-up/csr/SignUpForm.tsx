"use client";

import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  History,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  TriangleAlert,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Formik, Form, FormikHelpers } from "formik";
import * as Yup from "yup";
import { Actions } from "@/actions/client";
import {
  AuthAlert,
  AuthFieldError,
  AuthInput,
  AuthPage,
  authLabelClass,
} from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

const signUpSchema = Yup.object({
  fullName: Yup.string(),
  organizationName: Yup.string().required("Organization name is required"),
  email: Yup.string()
    .email("Please enter a valid email address")
    .required("Email is required"),
  password: Yup.string()
    .min(8, "Password must be at least 8 characters")
    .required("Password is required"),
  acceptedTerms: Yup.boolean().oneOf(
    [true],
    "You must accept the terms to continue",
  ),
});

type SignUpFormValues = Yup.InferType<typeof signUpSchema>;

const FREE_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "mail.com",
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function emailDomainState(email: string) {
  const parts = email.split("@");

  if (parts.length !== 2 || !parts[1]?.includes(".")) {
    return "pending";
  }

  return FREE_EMAIL_DOMAINS.includes(parts[1].toLowerCase())
    ? "free"
    : "corporate";
}

function passwordStrength(password: string) {
  const length = password.length;

  if (length === 0) {
    return {
      level: 0,
      tone: "",
      text: "Minimum 8 characters",
    };
  }

  if (length < 8) {
    return {
      level: 1,
      tone: "bg-error",
      text: `${length}/8 characters`,
    };
  }

  if (length < 12) {
    return {
      level: 2,
      tone: "bg-warning",
      text: "Acceptable",
    };
  }

  if (length < 16) {
    return {
      level: 3,
      tone: "bg-primary-fixed-dim",
      text: "Strong",
    };
  }

  return {
    level: 4,
    tone: "bg-success",
    text: "Very strong",
  };
}

const fieldClass =
  "h-10 rounded-[2px] bg-background px-3 text-sm placeholder:text-foreground-subtle focus:bg-surface-raised";

const iconClass =
  "pointer-events-none absolute right-3 size-4.5 text-foreground-subtle";

const fieldLabelClass = cn(authLabelClass, "text-muted-foreground");

export const SignUpForm = () => {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);

  // UI-only state. Not form values.
  const [subdomain, setSubdomain] = useState("acme");
  const [subdomainEdited, setSubdomainEdited] = useState(false);

  const initialValues: SignUpFormValues = {
    fullName: "",
    organizationName: "",
    email: "",
    password: "",
    acceptedTerms: false,
  };

  async function handleSubmit(
    values: SignUpFormValues,
    { setSubmitting, setStatus }: FormikHelpers<SignUpFormValues>,
  ) {
    setStatus(undefined);

    const { ok, body } = await Actions.Auth.signUp({
      fullName: values.fullName,
      organizationName: values.organizationName,
      email: values.email,
      password: values.password,
      acceptedTerms: values.acceptedTerms,
    });

    if (!ok) {
      setStatus(body.error ?? "Something went wrong");
      setSubmitting(false);
      return;
    }

    const signInResult = await Actions.Auth.signIn(
      values.email,
      values.password,
    );

    setSubmitting(false);

    if (!signInResult.ok) {
      router.push("/sign-in");
      return;
    }

    router.push("/onboarding");
  }

  return (
    <AuthPage>
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col py-4">
        <div className="relative w-full">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 left-1/2 h-48 w-3/4 -translate-x-1/2 rounded-full bg-primary/10 blur-[90px]"
          />

          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-10 right-10 size-64 rounded-full bg-primary/10 blur-[100px]"
          />

          <div className="relative z-10 w-full rounded-lg bg-background/95 p-4 shadow-2xl md:p-8">
            <div className="mb-6 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div
                className={cn(
                  authLabelClass,
                  "inline-flex items-center gap-1 rounded-[2px] bg-surface-raised px-2 py-1 tracking-wider text-primary",
                )}
              >
                <span className="size-1.5 animate-pulse rounded-full bg-success" />
                <span>
                  14-Day Instant Trial · Zero Write Permissions Required
                </span>
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
                commitment with one continuous clock across support,
                engineering, and the systems your teams rely on.
              </p>
            </div>

            <Formik
              initialValues={initialValues}
              validationSchema={signUpSchema}
              onSubmit={handleSubmit}
            >
              {({
                errors,
                touched,
                isSubmitting,
                status,
                values,
                getFieldProps,
                setFieldValue,
              }) => {
                const domainState = emailDomainState(values.email);
                const strength = passwordStrength(values.password);

                return (
                  <Form className="space-y-4">
                    {/* Full Name + Email */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="fullName" className={fieldLabelClass}>
                          Full Name
                        </label>

                        <div className="relative flex items-center">
                          <AuthInput
                            {...getFieldProps("fullName")}
                            id="fullName"
                            autoComplete="name"
                            placeholder="Elena Rostova"
                            className={fieldClass}
                          />

                          <User aria-hidden className={iconClass} />
                        </div>

                        <AuthFieldError
                          id="full-name-error"
                          message={
                            touched.fullName ? errors.fullName : undefined
                          }
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <label htmlFor="email" className={fieldLabelClass}>
                            Work Email <span className="text-error">*</span>
                          </label>

                          <span
                            className={cn(
                              authLabelClass,
                              "rounded-[2px] px-1.5 py-0.5",
                              domainState === "corporate" &&
                                "bg-success/10 text-success",
                              domainState === "free" &&
                                "bg-error/10 text-error",
                              domainState === "pending" &&
                                "bg-warning/10 text-warning",
                            )}
                          >
                            {domainState === "corporate"
                              ? "Valid Corporate Domain"
                              : "Corporate Domain Required"}
                          </span>
                        </div>

                        <div className="relative flex items-center">
                          <AuthInput
                            {...getFieldProps("email")}
                            id="email"
                            type="email"
                            autoComplete="email"
                            placeholder="elena@company.com"
                            className={fieldClass}
                            aria-invalid={Boolean(
                              touched.email && errors.email,
                            )}
                            aria-describedby={
                              touched.email && errors.email
                                ? "email-error"
                                : undefined
                            }
                          />

                          {domainState === "corporate" ? (
                            <CheckCircle2
                              aria-hidden
                              className={cn(iconClass, "text-success")}
                            />
                          ) : domainState === "free" ? (
                            <TriangleAlert
                              aria-hidden
                              className={cn(iconClass, "text-error")}
                            />
                          ) : (
                            <Mail aria-hidden className={iconClass} />
                          )}
                        </div>

                        <AuthFieldError
                          id="email-error"
                          message={touched.email ? errors.email : undefined}
                        />
                      </div>
                    </div>

                    {/* Organization + Subdomain */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="organizationName"
                          className={fieldLabelClass}
                        >
                          Company / Workspace Name{" "}
                          <span className="text-error">*</span>
                        </label>

                        <div className="relative flex items-center">
                          <AuthInput
                            {...getFieldProps("organizationName")}
                            id="organizationName"
                            autoComplete="organization"
                            placeholder="Acme Cloud Logistics"
                            className={fieldClass}
                            onChange={(event) => {
                              setFieldValue(
                                "organizationName",
                                event.target.value,
                              );

                              if (!subdomainEdited) {
                                setSubdomain(
                                  slugify(event.target.value) || "workspace",
                                );
                              }
                            }}
                            aria-invalid={Boolean(
                              touched.organizationName &&
                              errors.organizationName,
                            )}
                            aria-describedby={
                              touched.organizationName &&
                              errors.organizationName
                                ? "organization-name-error"
                                : undefined
                            }
                          />

                          <Building2 aria-hidden className={iconClass} />
                        </div>

                        <AuthFieldError
                          id="organization-name-error"
                          message={
                            touched.organizationName
                              ? errors.organizationName
                              : undefined
                          }
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="subdomain"
                            className={fieldLabelClass}
                          >
                            Workspace Subdomain Routing
                          </label>

                          <span className={cn(authLabelClass, "text-success")}>
                            AVAILABLE
                          </span>
                        </div>

                        <div className="flex h-10 items-center overflow-hidden rounded-[2px] bg-background px-3 transition-all focus-within:bg-surface-raised focus-within:ring-1 focus-within:ring-ring">
                          <span className="select-none font-mono text-xs font-medium text-foreground-subtle">
                            https://
                          </span>

                          <input
                            id="subdomain"
                            value={subdomain}
                            onChange={(event) => {
                              setSubdomainEdited(true);
                              setSubdomain(slugify(event.target.value));
                            }}
                            className="w-full min-w-15 bg-transparent px-1 font-mono text-xs font-semibold text-primary outline-none ring-0 border-none focus:outline-none"
                          />

                          <span className="select-none font-mono text-xs font-medium text-foreground-subtle">
                            .elapsed.io
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Password */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="password" className={fieldLabelClass}>
                          Password <span className="text-error">*</span>
                        </label>

                        <div
                          className={cn(
                            authLabelClass,
                            "flex items-center gap-1 text-primary-fixed-dim",
                          )}
                        >
                          <Lock aria-hidden className="size-3.5" />

                          <span>{strength.text}</span>
                        </div>
                      </div>

                      <div className="relative flex items-center">
                        <AuthInput
                          {...getFieldProps("password")}
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder="••••••••••••••••"
                          className={cn(fieldClass, "pr-10")}
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
                          className="absolute right-3 text-foreground-subtle transition-colors hover:text-foreground focus:outline-none"
                        >
                          {showPassword ? (
                            <EyeOff aria-hidden className="size-4.5" />
                          ) : (
                            <Eye aria-hidden className="size-4.5" />
                          )}
                        </button>
                      </div>

                      <AuthFieldError
                        id="password-error"
                        message={touched.password ? errors.password : undefined}
                      />

                      <div className="grid grid-cols-4 gap-1.5 pt-1">
                        {[1, 2, 3, 4].map((segment) => (
                          <div
                            key={segment}
                            className={cn(
                              "h-1 rounded-[2px] transition-all",
                              segment <= strength.level
                                ? strength.tone
                                : "bg-border-strong",
                            )}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Terms */}
                    <div className="pt-1">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="acceptedTerms"
                          name="acceptedTerms"
                          checked={values.acceptedTerms}
                          onCheckedChange={(checked) =>
                            setFieldValue("acceptedTerms", checked === true)
                          }
                          className="mt-0.5 size-4 rounded"
                          aria-invalid={Boolean(
                            touched.acceptedTerms && errors.acceptedTerms,
                          )}
                          aria-describedby={
                            touched.acceptedTerms && errors.acceptedTerms
                              ? "accepted-terms-error"
                              : undefined
                          }
                        />

                        <label
                          htmlFor="acceptedTerms"
                          className="cursor-pointer select-none text-xs leading-tight text-muted-foreground transition-colors hover:text-foreground"
                        >
                          I accept the{" "}
                          <a
                            className="text-primary underline-offset-2 hover:underline"
                            href="/terms"
                          >
                            Terms of Service
                          </a>
                          ,{" "}
                          <a
                            className="text-primary underline-offset-2 hover:underline"
                            href="/privacy"
                          >
                            Privacy Policy
                          </a>
                          , and authenticate the{" "}
                          <span className="font-medium text-foreground">
                            Zero-Write Ingress Security Charter
                          </span>{" "}
                          (deterministic read-only readouts).
                        </label>
                      </div>

                      <AuthFieldError
                        id="accepted-terms-error"
                        message={
                          touched.acceptedTerms
                            ? errors.acceptedTerms
                            : undefined
                        }
                      />
                    </div>

                    {/* Server Error */}
                    {status && (
                      <AuthAlert
                        tone="danger"
                        icon={<AlertCircle aria-hidden />}
                      >
                        {status}
                      </AuthAlert>
                    )}

                    {/* Submit */}
                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-[2px] bg-primary px-6 py-3.5 font-mono text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary-hover hover:shadow-primary/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSubmitting && (
                          <Loader2
                            aria-hidden
                            className="size-4.5 animate-spin"
                          />
                        )}

                        <span>
                          {isSubmitting
                            ? "Creating account…"
                            : "Initialize Organization Workspace"}
                        </span>

                        {!isSubmitting && (
                          <ArrowRight aria-hidden className="size-4.5" />
                        )}
                      </button>
                    </div>
                  </Form>
                );
              }}
            </Formik>

            {/* Benefits */}
            <div className="mt-6 grid grid-cols-1 gap-2 pt-4 md:grid-cols-3">
              {[
                {
                  icon: ShieldCheck,
                  text: "Zero-write access tokens only",
                },
                {
                  icon: History,
                  text: "90-day backfill audit included",
                },
                {
                  icon: CreditCard,
                  text: "No credit card required",
                },
              ].map(({ icon: Icon, text }) => (
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
                className="ml-1 text-xs font-medium text-primary underline-offset-2 hover:text-primary-fixed-dim hover:underline"
              >
                Sign in →
              </a>
            </div>
          </div>
        </div>
      </div>
    </AuthPage>
  );
};
