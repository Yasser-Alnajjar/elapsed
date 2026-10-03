"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { useFormikContext } from "formik";
import {
  AuthFieldError,
  AuthInput,
  authLabelClass,
} from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";
import { fieldClass, fieldLabelClass, iconClass } from "./field-styles";
import type { SignUpFormValues } from "./sign-up-schema";
import { slugify } from "./sign-up-utils";

/**
 * Organization name plus its subdomain preview. The subdomain follows the
 * name until it is edited by hand; it is UI-only and never submitted.
 */
export function WorkspaceFields() {
  const { errors, touched, getFieldProps, setFieldValue } =
    useFormikContext<SignUpFormValues>();

  const [subdomain, setSubdomain] = useState("acme");
  const [subdomainEdited, setSubdomainEdited] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="organizationName" className={fieldLabelClass}>
          Company / Workspace Name <span className="text-error">*</span>
        </label>

        <div className="relative flex items-center">
          <AuthInput
            {...getFieldProps("organizationName")}
            id="organizationName"
            autoComplete="organization"
            placeholder="Acme Cloud Logistics"
            className={fieldClass}
            onChange={(event) => {
              setFieldValue("organizationName", event.target.value);

              if (!subdomainEdited) {
                setSubdomain(slugify(event.target.value) || "workspace");
              }
            }}
            aria-invalid={Boolean(
              touched.organizationName && errors.organizationName,
            )}
            aria-describedby={
              touched.organizationName && errors.organizationName
                ? "organization-name-error"
                : undefined
            }
          />

          <Building2 aria-hidden className={iconClass} />
        </div>

        <AuthFieldError
          id="organization-name-error"
          message={
            touched.organizationName ? errors.organizationName : undefined
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="subdomain" className={fieldLabelClass}>
            Workspace Subdomain Routing
          </label>

          <span className={cn(authLabelClass, "text-success")}>AVAILABLE</span>
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
  );
}
