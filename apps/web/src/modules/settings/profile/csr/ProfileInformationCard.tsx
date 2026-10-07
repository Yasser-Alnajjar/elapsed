"use client";

import { Loader2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialsOf } from "@/lib/format";
import { notify } from "@/lib/notify";
import type { IUser } from "@/lib/types/user";

interface ProfileInformationCardProps {
  user: IUser;
}

export function ProfileInformationCard({ user }: ProfileInformationCardProps) {
  const router = useRouter();
  const { update: updateSession } = useSession();

  const [name, setName] = useState(user.name ?? "");
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const dirty = trimmedName !== (user.name ?? "");
  const previewInitials = initialsOf(trimmedName || null, user.email);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmedName) return;

    setSaving(true);

    const { ok, body } = await Actions.Profile.update({
      name: trimmedName,
      image: user.image || null,
    });

    setSaving(false);

    if (!ok) {
      notify.error(body.error ?? "Failed to update profile.");
      return;
    }

    // Keeps `useSession()` in sync for the name; the avatar is never put in
    // the session — the sidebar reads it fresh from the database instead
    // (see `(main)/layout.tsx`).
    await updateSession({ name: body.name });
    notify.success("Profile updated.");
    router.refresh();
  }

  return (
    <Card className="bg-surface-container-low rounded-xl border-0 shadow-sm overflow-hidden">
      <CardHeader className="p-6 pb-0">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-container-highest text-primary">
            <UserRound className="size-4" />
          </span>
          <div>
            <CardTitle className="text-on-surface text-xl font-semibold tracking-tight">
              Profile information
            </CardTitle>
            <p className="mt-1 text-xs text-on-surface-variant">
              How you appear across this organization's workspace.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar size="lg">
              <AvatarImage src={user.image || undefined} alt="" />
              <AvatarFallback className="text-base">
                {previewInitials}
              </AvatarFallback>
            </Avatar>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              required
              maxLength={100}
              autoComplete="name"
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={!dirty || saving || !trimmedName}
            >
              {saving && <Loader2 className="animate-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
