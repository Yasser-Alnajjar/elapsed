"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { signOut } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRetryAfter } from "@/lib/auth-rate-limit";
import { useRetryCountdown } from "@/hooks/use-retry-countdown";
import { notify } from "@/lib/notify";

export function SecurityCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const retry = useRetryCountdown();

  const mismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setSaving(true);

    const { ok, body } = await Actions.Profile.changePassword({
      currentPassword,
      newPassword,
    });

    setSaving(false);

    if (!ok) {
      if (body.retryAfterSeconds) retry.start(body.retryAfterSeconds);
      notify.error(body.error ?? "Failed to change password.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    notify.success("Password updated. Signing you out…");

    // A password change invalidates every live session for this account,
    // including this one (roadmap 5.7's `User.sessionVersion` — see
    // `auth.ts`) — the next request this tab makes would fail anyway, so
    // sign out proactively and send the user to sign in with the new
    // password, rather than letting them hit a confusing 401 first.
    await signOut({ callbackUrl: "/sign-in" });
  }

  return (
    <Card className="bg-surface-container-low rounded-xl border-0 shadow-sm overflow-hidden">
      <CardHeader className="p-6 pb-0">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-container-highest text-primary">
            <KeyRound className="size-4" />
          </span>
          <div>
            <CardTitle className="text-on-surface text-xl font-semibold tracking-tight">
              Security
            </CardTitle>
            <p className="mt-1 text-xs text-on-surface-variant">
              Change the password used to sign in to this account.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                aria-invalid={mismatch}
              />
            </div>
          </div>

          {mismatch && (
            <p className="text-xs text-error">Passwords don&apos;t match.</p>
          )}

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!canSubmit || saving || retry.active}>
              {saving && <Loader2 className="animate-spin" />}
              {saving
                ? "Updating…"
                : retry.active
                  ? `Try again in ${formatRetryAfter(retry.remainingSeconds)}`
                  : "Update password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
