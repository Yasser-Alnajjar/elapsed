"use client";

import { useState } from "react";
import { Check, CheckCircle2 } from "lucide-react";
import { useFormikContext } from "formik";
import {
  AuthFieldError,
  AuthInput,
  authLabelClass,
  PasswordVisibilityToggle,
} from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";
import type { ResetPasswordFormValues } from "./reset-password-schema";

const fieldLabelClass = cn(
  authLabelClass,
  "text-xxs leading-[14px] tracking-[0.04em] text-muted-foreground",
);

const fieldClass =
  "rounded-[2px] bg-surface-container-lowest px-4 py-2 pe-12 font-mono text-sm font-medium focus:ring-offset-2 focus:ring-offset-surface-container-lowest";

/** New password and its confirmation; one toggle reveals both. */
export function NewPasswordFields() {
  const { errors, touched, values, getFieldProps } =
    useFormikContext<ResetPasswordFormValues>();
  const [showPassword, setShowPassword] = useState(false);

  const matches =
    values.confirmPassword.length > 0 &&
    values.confirmPassword === values.password;

  return (
    <>
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
            aria-invalid={Boolean(touched.password && errors.password)}
            aria-describedby={
              touched.password && errors.password ? "password-error" : undefined
            }
          />
          <PasswordVisibilityToggle
            shown={showPassword}
            onToggle={() => setShowPassword((shown) => !shown)}
            className="absolute inset-e-2 p-1 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
            iconClassName="size-5"
          />
        </div>
        <AuthFieldError
          id="password-error"
          message={touched.password ? errors.password : undefined}
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label htmlFor="confirmPassword" className={fieldLabelClass}>
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
            <div className="pointer-events-none absolute inset-e-4 flex items-center text-success">
              <Check aria-hidden className="size-5" />
            </div>
          )}
        </div>
        <AuthFieldError
          id="confirm-password-error"
          message={touched.confirmPassword ? errors.confirmPassword : undefined}
        />
      </div>
    </>
  );
}
