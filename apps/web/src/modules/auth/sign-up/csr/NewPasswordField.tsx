"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { useFormikContext } from "formik";
import {
  AuthFieldError,
  AuthInput,
  authLabelClass,
  PasswordVisibilityToggle,
} from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";
import { fieldClass, fieldLabelClass } from "./field-styles";
import type { SignUpFormValues } from "./sign-up-schema";
import { passwordStrength } from "./sign-up-utils";

/** Password with a visibility toggle and a four-segment strength meter. */
export function NewPasswordField() {
  const { errors, touched, values, getFieldProps } =
    useFormikContext<SignUpFormValues>();
  const [showPassword, setShowPassword] = useState(false);
  const strength = passwordStrength(values.password);

  return (
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
          className={cn(fieldClass, "pe-10")}
          aria-invalid={Boolean(touched.password && errors.password)}
          aria-describedby={
            touched.password && errors.password ? "password-error" : undefined
          }
        />

        <PasswordVisibilityToggle
          shown={showPassword}
          onToggle={() => setShowPassword((shown) => !shown)}
          className="absolute inset-e-3 text-foreground-subtle transition-colors hover:text-foreground focus:outline-none"
          iconClassName="size-4.5"
        />
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
              segment <= strength.level ? strength.tone : "bg-border-strong",
            )}
          />
        ))}
      </div>
    </div>
  );
}
