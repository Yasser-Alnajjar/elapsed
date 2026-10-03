import type { OrganizationInvitation, PrismaClient } from "../generated/prisma/client";
import { isUniqueConstraintError } from "./prisma-errors";
import { generateSecureToken, hashToken } from "./secure-token";

/** 7 days — long enough that a recipient checking email a day or two later isn't blocked, short enough that a stale, unused invitation doesn't sit valid indefinitely. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Matches `User.email`'s own normalization convention (see `apps/web/src/lib/sign-up.ts`'s zod schema and `auth-throttle.ts`'s `normalizeLoginIdentity`) — trim + lowercase, applied at every read/write that touches an email. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Thrown by both invitation creation and acceptance. Because `User.email`
 * is globally unique and this app has no multi-organization membership
 * model (see `OrganizationInvitation`'s schema doc comment), an email that
 * already belongs to a `User` — in this organization or any other — can
 * never accept a new invitation; there is no "attach as a second
 * membership" to fall back to. Surfaced as a clear, distinct error rather
 * than silently reusing the existing account or creating a duplicate.
 */
export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`${email} already has an account`);
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class InvitationNotFoundError extends Error {
  constructor() {
    super("Invitation not found");
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationExpiredError extends Error {
  constructor() {
    super("This invitation has expired");
    this.name = "InvitationExpiredError";
  }
}

/**
 * The invitation exists but is no longer `pending` — already accepted,
 * revoked, or (rarely) lost a race with a concurrent accept/revoke between
 * this call's initial read and its atomic claim. The caller can't tell
 * these apart from the error alone by design: by the time this throws, the
 * only thing that matters is that this call didn't get to consume it.
 */
export class InvitationNotPendingError extends Error {
  constructor() {
    super("This invitation is no longer valid");
    this.name = "InvitationNotPendingError";
  }
}

/**
 * Thrown only by `createOrResendInvitation`, when two concurrent invite (or
 * resend) calls for the same `(organizationId, email)` race past the
 * find-existing-pending check and both attempt to create — the partial
 * unique index is the real backstop; the loser sees this instead of a raw
 * database error. A retry (calling `createOrResendInvitation` again) finds
 * the winner's now-existing pending row and resends it normally.
 */
export class InvitationConflictError extends Error {
  constructor() {
    super("An invitation to this email is already being sent — try again");
    this.name = "InvitationConflictError";
  }
}

async function assertEmailNotRegistered(prisma: PrismaClient, email: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new EmailAlreadyRegisteredError(email);
}

export interface CreateOrResendInvitationResult {
  invitation: OrganizationInvitation;
  /** The raw token — exists only here and in the email built from it. Never persisted. */
  token: string;
  organizationName: string;
  /** Whether an existing pending invitation was reused (token rotated) rather than a new one created. */
  resent: boolean;
}

/**
 * Creates a new invitation, or — if one is already `pending` for this exact
 * `(organizationId, normalizedEmail)` — rotates its token and extends its
 * expiry instead of creating a second, simultaneously-valid one (roadmap
 * guardrail: at most one active invitation per org+email). The previous
 * token stops working the instant this returns, since only the new
 * `tokenHash` is stored.
 *
 * Rejects up front if the email already belongs to a `User` anywhere — see
 * `EmailAlreadyRegisteredError`'s doc comment for why that can never
 * resolve to "invite them anyway".
 */
export async function createOrResendInvitation(
  prisma: PrismaClient,
  input: { organizationId: string; invitedByUserId: string; email: string },
): Promise<CreateOrResendInvitationResult> {
  const email = normalizeEmail(input.email);

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true },
  });
  if (!organization) throw new InvitationNotFoundError();

  await assertEmailNotRegistered(prisma, email);

  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const existingPending = await prisma.organizationInvitation.findFirst({
    where: { organizationId: input.organizationId, email, status: "pending" },
  });

  try {
    const invitation = existingPending
      ? await prisma.organizationInvitation.update({
          where: { id: existingPending.id },
          data: { tokenHash, expiresAt, invitedByUserId: input.invitedByUserId },
        })
      : await prisma.organizationInvitation.create({
          data: {
            organizationId: input.organizationId,
            email,
            tokenHash,
            expiresAt,
            invitedByUserId: input.invitedByUserId,
          },
        });

    return { invitation, token, organizationName: organization.name, resent: existingPending !== null };
  } catch (error) {
    // Lost a race against another concurrent invite for the same email —
    // the partial unique index (organizationId, email) WHERE status =
    // 'pending' is what actually enforces this; the findFirst above is only
    // an optimization to prefer an update over a doomed create.
    if (isUniqueConstraintError(error)) throw new InvitationConflictError();
    throw error;
  }
}

export async function listPendingInvitations(
  prisma: PrismaClient,
  organizationId: string,
): Promise<OrganizationInvitation[]> {
  return prisma.organizationInvitation.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
}

/** No-op (not an error) if the invitation is already resolved (accepted/revoked) or doesn't belong to this organization — revoking is idempotent and scoped. */
export async function revokeInvitation(
  prisma: PrismaClient,
  input: { organizationId: string; invitationId: string },
): Promise<void> {
  await prisma.organizationInvitation.updateMany({
    where: { id: input.invitationId, organizationId: input.organizationId, status: "pending" },
    data: { status: "revoked", revokedAt: new Date() },
  });
}

export interface InvitationPreview {
  organizationName: string;
  email: string;
  /** True when this email now belongs to a `User` — the accept page should show a "sign in instead" message rather than an account-creation form. */
  alreadyRegistered: boolean;
}

/**
 * Read-only lookup for the accept page to render before the visitor submits
 * anything — resolves the token but never consumes it. Returns `null` for
 * an unknown token; throws the same typed errors `acceptInvitation` does
 * for expired/not-pending, so the page can show one consistent message
 * either way.
 */
export async function previewInvitation(prisma: PrismaClient, token: string): Promise<InvitationPreview | null> {
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } } },
  });
  if (!invitation) return null;
  if (invitation.status !== "pending") throw new InvitationNotPendingError();
  if (invitation.expiresAt <= new Date()) throw new InvitationExpiredError();

  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });

  return {
    organizationName: invitation.organization.name,
    email: invitation.email,
    alreadyRegistered: existing !== null,
  };
}

export interface AcceptInvitationInput {
  token: string;
  name: string;
  passwordHash: string;
}

export interface AcceptInvitationResult {
  userId: string;
  organizationId: string;
  email: string;
}

/**
 * Validates the token, its expiry, and that it hasn't already been
 * accepted/revoked, then atomically creates the `User` (role `member`) and
 * marks the invitation `accepted` — both succeed or both roll back. See
 * `OrganizationInvitation`'s and this file's own doc comments for why a
 * `User` created this way never carries any authorization of its own
 * beyond ordinary organization membership: this function's only output is
 * a `User` row, exactly like sign-up's; nothing reads `OrganizationInvitation.status`
 * for access control anywhere else in the app.
 *
 * The single-use/race-safety guarantee: the invitation is claimed inside
 * the transaction via a conditional `updateMany` (`WHERE status =
 * 'pending'`) — if two accept attempts for the same token run concurrently,
 * Postgres's row lock on that `UPDATE` serializes them, and the loser's
 * `updateMany` matches zero rows once it proceeds (the row is no longer
 * `pending`), so only one `User` is ever created. `passwordHash` is
 * computed by the caller (bcrypt, same cost factor as sign-up) — this
 * function is deliberately password-hashing-agnostic, same separation as
 * `apps/web/src/app/api/sign-up/route.ts`.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const tokenHash = hashToken(input.token);
  const invitation = await prisma.organizationInvitation.findUnique({ where: { tokenHash } });
  if (!invitation) throw new InvitationNotFoundError();
  if (invitation.status !== "pending") throw new InvitationNotPendingError();
  if (invitation.expiresAt <= new Date()) throw new InvitationExpiredError();

  await assertEmailNotRegistered(prisma, invitation.email);

  return prisma.$transaction(async (tx) => {
    const claim = await tx.organizationInvitation.updateMany({
      where: { id: invitation.id, status: "pending" },
      data: { status: "accepted", acceptedAt: new Date() },
    });
    if (claim.count === 0) throw new InvitationNotPendingError();

    let user;
    try {
      user = await tx.user.create({
        data: {
          organizationId: invitation.organizationId,
          email: invitation.email,
          passwordHash: input.passwordHash,
          name: input.name,
          role: "member",
          // Clicking this emailed link is already proof of control over
          // this address (roadmap 5.6) — no separate verification step.
          emailVerifiedAt: new Date(),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new EmailAlreadyRegisteredError(invitation.email);
      throw error;
    }

    await tx.organizationInvitation.update({
      where: { id: invitation.id },
      data: { acceptedByUserId: user.id },
    });

    return { userId: user.id, organizationId: user.organizationId, email: user.email };
  });
}
