"use client";

import { useFormikContext } from "formik";
import { AuthFieldError } from "@/components/shared/auth-shell";
import { Checkbox } from "@/components/ui/checkbox";
import type { SignUpFormValues } from "./sign-up-schema";

/** The required terms / privacy / security-charter acceptance. */
export function TermsField() {
  const { errors, touched, values, setFieldValue } =
    useFormikContext<SignUpFormValues>();

  return (
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
          aria-invalid={Boolean(touched.acceptedTerms && errors.acceptedTerms)}
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
        message={touched.acceptedTerms ? errors.acceptedTerms : undefined}
      />
    </div>
  );
}
