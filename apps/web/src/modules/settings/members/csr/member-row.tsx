"use client";

import { AlertCircle, Loader2, X } from "lucide-react";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { useFormik } from "formik";
import * as Yup from "yup";

import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrganizationMemberSummary } from "@/lib/types/members";
import type { UserRole } from "@/lib/types/user";
import { formatDateTime } from "@/lib/format";

interface MemberRowProps {
  member: OrganizationMemberSummary;
  isSelf: boolean;
  onSaved: () => void;
}

const roleSchema = Yup.object({
  role: Yup.mixed<UserRole>().oneOf(["owner", "member"]).required(),
});

export function MemberRow({ member, isSelf, onSaved }: MemberRowProps) {
  const timeZone = useOrgTimezone();
  const formik = useFormik<{ role: UserRole }>({
    initialValues: {
      role: member.role,
    },
    validationSchema: roleSchema,
    enableReinitialize: true,
    onSubmit: async (values, { setStatus, resetForm }) => {
      setStatus(undefined);

      const { ok, body } = await Actions.Members.updateRole(
        member.id,
        values.role,
      );

      if (!ok) {
        setStatus(body.error ?? "Failed to update role");
        resetForm();
        return;
      }

      onSaved();
    },
  });

  async function handleRemove() {
    const { ok, error } = await Actions.Members.remove(member.id);

    if (!ok) {
      formik.setStatus(error ?? "Failed to remove member");
      return;
    }

    onSaved();
  }

  const roleDirty = formik.values.role !== member.role;

  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex items-center gap-2">
            <Avatar>
              <AvatarFallback
                className={
                  isSelf
                    ? "bg-primary text-on-primary text-xs font-bold"
                    : "bg-surface-container-highest text-on-surface text-xs"
                }
              >
                {initialsOf(member.name, member.email)}
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-col">
              <span className="text-on-surface text-sm font-medium">
                {member.name ?? member.email}
              </span>
              {isSelf && (
                <span className="text-primary font-mono text-xxs uppercase">
                  Current user
                </span>
              )}
            </div>
          </div>
        </TableCell>

        <TableCell
          truncate
          title={member.email}
          className="text-on-surface-variant font-mono text-xs"
        >
          {member.email}
        </TableCell>

        <TableCell>
          <div className="flex items-center gap-2">
            <Select
              value={formik.values.role}
              onValueChange={(value) =>
                formik.setFieldValue("role", value as UserRole)
              }
              disabled={formik.isSubmitting}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>

            {roleDirty && (
              <Button
                type="button"
                size="sm"
                onClick={() => formik.submitForm()}
                disabled={formik.isSubmitting}
              >
                {formik.isSubmitting && <Loader2 className="animate-spin" />}

                {formik.isSubmitting ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        </TableCell>

        <TableCell nowrap className="text-on-surface-variant font-mono text-xs">
          {formatDateTime(member.createdAt, timeZone)}
        </TableCell>

        <TableCell align="end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleRemove}
            disabled={isSelf || formik.isSubmitting}
            title={isSelf ? "You can't remove yourself" : undefined}
          >
            {formik.isSubmitting ? <Loader2 className="animate-spin" /> : <X />}
            Remove
          </Button>
        </TableCell>
      </TableRow>

      {formik.status && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="pt-0">
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formik.status}</AlertDescription>
            </Alert>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
