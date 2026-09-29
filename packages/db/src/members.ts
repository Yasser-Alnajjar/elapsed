import type { PrismaClient, UserRole } from "../generated/prisma/client";

export class MemberNotFoundError extends Error {
  constructor() {
    super("Member not found");
    this.name = "MemberNotFoundError";
  }
}

/**
 * Removing yourself from this page is refused outright rather than treated
 * as a variant of `removeMember` — there is no `User.sessionVersion` yet
 * (roadmap 5.7), so a self-removal would leave the caller mid-request with
 * a session that still validates against a `User` row that no longer
 * exists. A real "leave this organization" flow, if ever built, would need
 * that session-invalidation work done first; this task doesn't attempt it.
 */
export class CannotRemoveSelfError extends Error {
  constructor() {
    super("You can't remove yourself");
    this.name = "CannotRemoveSelfError";
  }
}

/**
 * Thrown by both `removeMember` and `updateMemberRole` (demoting to
 * `member`) when the target is the organization's only `owner`. Nothing
 * upstream of this file counts owners today (see this task's own roadmap
 * note) — an ownerless organization would still function, but every
 * owner-only action the roadmap plans for 5.4 would become permanently
 * unreachable without direct database access, so this invariant is
 * enforced here rather than left for 5.4 to discover.
 */
export class LastOwnerError extends Error {
  constructor() {
    super("An organization must have at least one owner");
    this.name = "LastOwnerError";
  }
}

export interface OrganizationMember {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: Date;
}

export async function listMembers(prisma: PrismaClient, organizationId: string): Promise<OrganizationMember[]> {
  return prisma.user.findMany({
    where: { organizationId },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

async function countOwners(prisma: PrismaClient, organizationId: string): Promise<number> {
  return prisma.user.count({ where: { organizationId, role: "owner" } });
}

/** No-op if the requested role is already the member's current role — idempotent, same convention as `revokeInvitation`. */
export async function updateMemberRole(
  prisma: PrismaClient,
  input: { organizationId: string; memberId: string; role: UserRole },
): Promise<void> {
  const member = await prisma.user.findFirst({
    where: { id: input.memberId, organizationId: input.organizationId },
    select: { role: true },
  });
  if (!member) throw new MemberNotFoundError();
  if (member.role === input.role) return;

  if (member.role === "owner" && input.role === "member" && (await countOwners(prisma, input.organizationId)) <= 1) {
    throw new LastOwnerError();
  }

  await prisma.user.updateMany({
    where: { id: input.memberId, organizationId: input.organizationId },
    // The role is baked into the member's JWT at sign-in and never re-read
    // (see `auth.ts`'s `jwt` callback), so without a `sessionVersion` bump a
    // demoted owner would keep owner powers until the token expires (30 days).
    // Bumping signs the member out; they sign back in with the new role.
    data: { role: input.role, sessionVersion: { increment: 1 } },
  });
}

export async function removeMember(
  prisma: PrismaClient,
  input: { organizationId: string; memberId: string; actingUserId: string },
): Promise<void> {
  if (input.memberId === input.actingUserId) throw new CannotRemoveSelfError();

  const member = await prisma.user.findFirst({
    where: { id: input.memberId, organizationId: input.organizationId },
    select: { role: true },
  });
  if (!member) throw new MemberNotFoundError();

  if (member.role === "owner" && (await countOwners(prisma, input.organizationId)) <= 1) {
    throw new LastOwnerError();
  }

  // OrganizationInvitation.invitedByUserId/acceptedByUserId are both
  // SetNull (see that model's schema doc comment, added by 5.2 for exactly
  // this) — no cascading cleanup needed here.
  await prisma.user.deleteMany({ where: { id: input.memberId, organizationId: input.organizationId } });
}
