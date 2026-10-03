"use client";

import { AlertCircle, CheckCircle2, Loader2, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialsOf } from "@/lib/format";
import type { IUser } from "@/lib/types/user";

interface ProfileInformationCardProps {
  user: IUser;
}

interface SaveResult {
  ok: boolean;
  message?: string;
  error?: string;
}

const AVATAR_MAX_DIMENSION = 256;
const AVATAR_JPEG_QUALITY = 0.85;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Resizes/crops to a square JPEG so the encoded `data:` URL stays small
 * enough to store directly on `User.image` (see `updateProfileSchema`). */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const size = Math.min(AVATAR_MAX_DIMENSION, side);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);

  return canvas.toDataURL("image/jpeg", AVATAR_JPEG_QUALITY);
}

export function ProfileInformationCard({ user }: ProfileInformationCardProps) {
  const router = useRouter();
  const { update: updateSession } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user.name ?? "");
  const [image, setImage] = useState(user.image ?? "");
  // const [avatarError, setAvatarError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const trimmedName = name.trim();
  const dirty =
    trimmedName !== (user.name ?? "") || image !== (user.image ?? "");
  const previewInitials = initialsOf(trimmedName || null, user.email);

  // async function handleAvatarSelected(event: ChangeEvent<HTMLInputElement>) {
  //   const file = event.target.files?.[0];
  //   event.target.value = "";
  //   if (!file) return;

  //   setAvatarError(null);

  //   if (!file.type.startsWith("image/")) {
  //     setAvatarError("Choose an image file.");
  //     return;
  //   }
  //   if (file.size > MAX_UPLOAD_BYTES) {
  //     setAvatarError("Image must be 8MB or smaller.");
  //     return;
  //   }

  //   try {
  //     setImage(await fileToAvatarDataUrl(file));
  //   } catch {
  //     setAvatarError("Couldn't read that image — try a different file.");
  //   }
  // }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmedName) return;

    setSaving(true);
    setResult(null);

    const { ok, body } = await Actions.Profile.update({
      name: trimmedName,
      image: image || null,
    });

    setSaving(false);

    if (!ok) {
      setResult({ ok: false, error: body.error ?? "Failed to update profile" });
      return;
    }

    // Keeps `useSession()` in sync for the name; the avatar is never put in
    // the session — the sidebar reads it fresh from the database instead
    // (see `(main)/layout.tsx`).
    await updateSession({ name: body.name });
    setResult({ ok: true, message: "Profile updated." });
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
              <AvatarImage src={image || undefined} alt="" />
              <AvatarFallback className="text-base">
                {previewInitials}
              </AvatarFallback>
            </Avatar>

            {/* <div className="space-y-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarSelected}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="surface"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload photo
                </Button>
                {image && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setImage("")}
                  >
                    <X className="size-4" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-on-surface-variant">
                JPG, PNG, WEBP or GIF. Up to 8MB.
              </p>
              {avatarError && (
                <p className="text-xs text-error">{avatarError}</p>
              )}
            </div> */}
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

          {result && (
            <Alert variant={result.ok ? "success" : "destructive"}>
              {result.ok ? <CheckCircle2 /> : <AlertCircle />}
              <AlertDescription>
                {result.ok ? result.message : result.error}
              </AlertDescription>
            </Alert>
          )}

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
