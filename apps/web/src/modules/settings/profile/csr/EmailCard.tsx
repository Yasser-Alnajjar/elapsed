"use client";

import { Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/lib/notify";
import type { IUser } from "@/lib/types/user";

interface EmailCardProps {
  user: IUser;
}

export function EmailCard({ user }: EmailCardProps) {
  const router = useRouter();
  const [resending, setResending] = useState(false);

  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showChangeForm, setShowChangeForm] = useState(false);

  async function handleResend() {
    setResending(true);
    const { ok, body } = await Actions.Profile.resendVerification();
    setResending(false);
    if (ok) notify.success("Verification email sent — check your inbox.");
    else notify.error(body.error ?? "Failed to send verification email.");
  }

  async function handleChangeSubmit(event: FormEvent) {
    event.preventDefault();
    setChanging(true);

    const { ok, body } = await Actions.Profile.requestEmailChange({ newEmail, currentPassword });
    setChanging(false);

    if (!ok) {
      notify.error(body.error ?? "Failed to request email change.");
      return;
    }

    setCurrentPassword("");
    notify.success(`Check ${newEmail} for a link to confirm this change.`);
    router.refresh();
  }

  return (
    <Card className="bg-surface-container-low rounded-xl border-0 shadow-sm overflow-hidden">
      <CardHeader className="p-6 pb-0">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-container-highest text-primary">
            <Mail className="size-4" />
          </span>
          <div>
            <CardTitle className="text-on-surface text-xl font-semibold tracking-tight">Email</CardTitle>
            <p className="mt-1 text-xs text-on-surface-variant">The address you sign in with and receive notifications at.</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-6 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1.5">
            <Label>Current email</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm">{user.email}</span>
              <Badge variant={user.emailVerifiedAt ? "success" : "warning"}>
                {user.emailVerifiedAt ? "Verified" : "Unverified"}
              </Badge>
            </div>
          </div>
          {!user.emailVerifiedAt && (
            <Button type="button" variant="surface" size="sm" disabled={resending} onClick={handleResend}>
              {resending && <Loader2 className="animate-spin" />}
              {resending ? "Sending…" : "Resend verification"}
            </Button>
          )}
        </div>

        {!showChangeForm && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowChangeForm(true)}>
            Change email
          </Button>
        )}

        {showChangeForm && (
          <form onSubmit={handleChangeSubmit} className="space-y-4 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-email">New email</Label>
              <Input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                required
                autoComplete="email"
                placeholder="you@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-change-current-password">Current password</Label>
              <Input
                id="email-change-current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowChangeForm(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={changing || !newEmail || !currentPassword}>
                {changing && <Loader2 className="animate-spin" />}
                {changing ? "Sending…" : "Send confirmation link"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
