"use client";

import { CheckCircle2, Mail, TriangleAlert, User } from "lucide-react";
import { useFormikContext } from "formik";
import {
  AuthFieldError,
  AuthInput,
  authLabelClass,
} from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";
import { fieldClass, fieldLabelClass, iconClass } from "./field-styles";
import type { SignUpFormValues } from "./sign-up-schema";
import { emailDomainState } from "./sign-up-utils";

/** Full name and work email, with the email's corporate-domain readout. */
export function IdentityFields() {
  const { errors, touched, values, getFieldProps } =
    useFormikContext<SignUpFormValues>();
  const domainState = emailDomainState(values.email);

  return (
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
          message={touched.fullName ? errors.fullName : undefined}
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
              domainState === "corporate" && "bg-success/10 text-success",
              domainState === "free" && "bg-error/10 text-error",
              domainState === "pending" && "bg-warning/10 text-warning",
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
            aria-invalid={Boolean(touched.email && errors.email)}
            aria-describedby={
              touched.email && errors.email ? "email-error" : undefined
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
  );
}
