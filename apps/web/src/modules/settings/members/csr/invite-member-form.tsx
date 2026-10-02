"use client";

import { AlertCircle, CheckCircle2, Loader2, Mail } from "lucide-react";
import { useFormik } from "formik";
import * as Yup from "yup";

import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EntitlementWarningAlert, type EntitlementWarningPayload } from "@/components/shared/entitlement-alerts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InviteMemberFormProps {
  onInvited: () => void;
}

const inviteSchema = Yup.object({
  email: Yup.string()
    .email("Enter a valid email address")
    .required("Email is required"),
});

export function InviteMemberForm({ onInvited }: InviteMemberFormProps) {
  const formik = useFormik({
    initialValues: {
      email: "",
    },
    validationSchema: inviteSchema,
    onSubmit: async (values, { setStatus, resetForm }) => {
      setStatus(undefined);

      const { ok, body } = await Actions.Invitations.invite(
        values.email.trim(),
      );

      if (!ok) {
        setStatus({
          type: "error",
          message: body.error ?? "Failed to send invitation",
        });
        return;
      }

      resetForm();

      setStatus({
        type: "success",
        message: body.resent ? "Invitation resent." : "Invitation sent.",
        // Soft limit (N6.3): the invitation went out; this only tells the owner where they stand.
        warning: body.entitlementWarning,
      });

      onInvited();
    },
  });

  const status = formik.status as
    | { type: "success" | "error"; message: string; warning?: EntitlementWarningPayload }
    | undefined;

  return (
    <Card className="bg-surface-container-low rounded-xl border-0 shadow-sm p-6">
      <CardHeader className="flex flex-row items-center gap-3 p-0">
        <span className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-container-highest text-primary">
          <Mail className="size-4" />
        </span>

        <div>
          <CardTitle className="text-on-surface text-xl font-semibold tracking-tight">
            Invite a member
          </CardTitle>

          <p className="text-sm text-on-surface-variant">
            They&apos;ll get an email with a single-use link to join, expiring
            in 7 days.
          </p>
        </div>
      </CardHeader>

      <CardContent className="p-0 pt-5">
        <form
          onSubmit={formik.handleSubmit}
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>

            <Input
              id="invite-email"
              name="email"
              type="email"
              value={formik.values.email}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              placeholder="teammate@example.com"
              disabled={formik.isSubmitting}
              aria-invalid={formik.touched.email && !!formik.errors.email}
            />

            {formik.touched.email && formik.errors.email && (
              <p className="text-sm text-error">{formik.errors.email}</p>
            )}
          </div>

          <Button type="submit" size="sm" disabled={formik.isSubmitting}>
            {formik.isSubmitting && <Loader2 className="animate-spin" />}

            {formik.isSubmitting ? "Sending…" : "Send invitation"}
          </Button>
        </form>

        {status && (
          <Alert
            variant={status.type === "success" ? "success" : "destructive"}
            className="mt-3"
          >
            {status.type === "success" ? <CheckCircle2 /> : <AlertCircle />}

            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        )}

        {status?.type === "success" && status.warning && (
          <div className="mt-3">
            <EntitlementWarningAlert warning={status.warning} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
