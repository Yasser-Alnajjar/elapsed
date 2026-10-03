import type { PrismaClient } from "../generated/prisma/client";
import { isUniqueConstraintError } from "./prisma-errors";
import { generateSecureToken, hashToken } from "./secure-token";
import { EmailAlreadyRegisteredError, normalizeEmail } from "./invitations";

/**
 * 24 hours — longer than a password reset's 1 hour (this token can't take
 * over an account on its own; at worst it confirms an address or, for a
 * change, moves the account to an address the requester already proved
 * they typed correctly by receiving mail there), shorter than an
 * invitation's 7 days.
 */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export class EmailVerificationTokenNotFoundError extends Error {
  constructor() {
    super("This verification link is invalid");
    this.name = "EmailVerificationTokenNotFoundError";
  }
}

export class EmailVerificationTokenExpiredError extends Error {
  constructor() {
    super("This verification link has expired");
    this.name = "EmailVerificationTokenExpiredError";
  }
}

export class EmailVerificationTokenUsedError extends Error {
  constructor() {
    super("This verification link has already been used");
    this.name = "EmailVerificationTokenUsedError";
  }
}

export interface IssueTokenResult {
  /** The raw token — exists only here and in the email built from it. Never persisted. */
  token: string;
}

/**
 * Issues a token that verifies the user's *current* email (signup
 * verification, or a resend of it) — `newEmail` is left null. Deletes any
 * prior unused signup-verification token for this user first, same
 * "requesting again invalidates the old link" behavior as
 * `requestPasswordReset`.
 */
export async function createEmailVerificationToken(
  prisma: PrismaClient,
  userId: string,
): Promise<IssueTokenResult> {
  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.deleteMany({ where: { userId, newEmail: null, usedAt: null } });
    await tx.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt, newEmail: null } });
  });

  return { token };
}

/**
 * Issues a token for changing the account's email to `newEmail` — nothing
 * on `User` changes until this token is consumed (see `verifyEmail`).
 * Rejects up front if `newEmail` already belongs to any `User`, same
 * up-front check `createOrResendInvitation` does for the same reason
 * (global email uniqueness, no multi-org membership to fall back to).
 */
export async function createEmailChangeToken(
  prisma: PrismaClient,
  input: { userId: string; newEmail: string },
): Promise<IssueTokenResult> {
  const newEmail = normalizeEmail(input.newEmail);

  const existing = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existing) throw new EmailAlreadyRegisteredError(newEmail);

  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.deleteMany({
      where: { userId: input.userId, newEmail: { not: null }, usedAt: null },
    });
    await tx.emailVerificationToken.create({
      data: { userId: input.userId, tokenHash, expiresAt, newEmail },
    });
  });

  return { token };
}

export interface VerifyEmailResult {
  userId: string;
  email: string;
}

/**
 * Validates the token, its expiry, and that it hasn't already been used,
 * then atomically claims it and either marks the account's current email
 * verified (`newEmail` null) or moves `User.email` to `newEmail` and marks
 * *that* verified — same single-use/race-safety shape as `resetPassword`
 * and `acceptInvitation`: the token is claimed inside the transaction via
 * a conditional `updateMany` (`WHERE usedAt IS NULL`).
 *
 * For a change-email token, `newEmail`'s uniqueness is re-checked by the
 * database itself at write time (not just at `createEmailChangeToken`
 * time): if someone else registered that exact address in the window
 * between issuing this token and consuming it, the `User.email` update's
 * own unique constraint fails and this throws `EmailAlreadyRegisteredError`
 * instead of silently colliding — rolled back along with the token claim.
 */
export async function verifyEmail(prisma: PrismaClient, token: string): Promise<VerifyEmailResult> {
  const tokenHash = hashToken(token);
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!record) throw new EmailVerificationTokenNotFoundError();
  if (record.usedAt) throw new EmailVerificationTokenUsedError();
  if (record.expiresAt <= new Date()) throw new EmailVerificationTokenExpiredError();

  return prisma.$transaction(async (tx) => {
    const claim = await tx.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count === 0) throw new EmailVerificationTokenUsedError();

    let user;
    try {
      user = await tx.user.update({
        where: { id: record.userId },
        data: {
          emailVerifiedAt: new Date(),
          ...(record.newEmail ? { email: record.newEmail } : {}),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new EmailAlreadyRegisteredError(record.newEmail ?? "");
      throw error;
    }

    return { userId: user.id, email: user.email };
  });
}
