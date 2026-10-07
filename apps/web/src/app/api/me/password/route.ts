import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { tooManyAttemptsMessage } from "@/lib/auth-rate-limit";
import {
  checkAuthThrottle,
  clearAuthThrottle,
  recordFailedAuthAttempt,
} from "@/lib/auth-throttle";
import { changePasswordSchema } from "@/lib/profile";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Same progressive-cooldown throttle sign-in uses (`@/lib/auth-throttle`),
  // keyed per-user here since the caller is already authenticated — this
  // only slows down someone who has hijacked a live session and is guessing
  // at the current password to lock the real owner out.
  const throttleKey = `change-password:${session.user.id}`;
  const throttle = checkAuthThrottle(throttleKey);
  if (throttle.throttled) {
    return NextResponse.json(
      {
        error: tooManyAttemptsMessage(throttle.retryAfterSeconds ?? 60),
        retryAfterSeconds: throttle.retryAfterSeconds ?? 60,
      },
      { status: 429 },
    );
  }

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const valid = await bcrypt.compare(
    parsed.data.currentPassword,
    user.passwordHash,
  );
  if (!valid) {
    recordFailedAuthAttempt(throttleKey);
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 400 },
    );
  }

  clearAuthThrottle(throttleKey);

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    // `sessionVersion` increment signs out every live session for this
    // account, including the caller's own current one (roadmap 5.7) — see
    // `auth.ts`'s `jwt` callback. The Security card (Profile page) signs
    // the caller out proactively right after this succeeds rather than
    // leaving them to hit a confusing 401 on their next request.
    data: { passwordHash, sessionVersion: { increment: 1 } },
  });

  return NextResponse.json({ ok: true });
}
