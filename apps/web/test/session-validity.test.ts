/**
 * `assertSessionStillValid` (roadmap 5.7): the DB re-check `auth.ts`'s
 * `jwt` callback runs on every request after the initial sign-in. Tested
 * directly here (mocked Prisma) rather than through NextAuth's own
 * callback machinery — see `@/lib/session-validity`'s doc comment for why.
 */
import { describe, expect, it, vi } from "vitest";
import { SessionInvalidatedError, assertSessionStillValid } from "../src/lib/session-validity";

function fakePrisma(user: { sessionVersion: number; emailVerifiedAt?: Date | null } | null) {
  return { user: { findUnique: vi.fn(async () => user) } } as unknown as Parameters<
    typeof assertSessionStillValid
  >[0];
}

const VERIFIED = new Date("2024-01-02T00:00:00.000Z");

describe("assertSessionStillValid", () => {
  it("resolves without throwing when the token's sessionVersion still matches the database", async () => {
    const prisma = fakePrisma({ sessionVersion: 2, emailVerifiedAt: VERIFIED });
    await expect(assertSessionStillValid(prisma, { userId: "u1", sessionVersion: 2 })).resolves.toBeUndefined();
  });

  it("throws SessionInvalidatedError when the database's sessionVersion has moved past the token's (password changed)", async () => {
    const prisma = fakePrisma({ sessionVersion: 3, emailVerifiedAt: VERIFIED });
    await expect(assertSessionStillValid(prisma, { userId: "u1", sessionVersion: 2 })).rejects.toBeInstanceOf(
      SessionInvalidatedError,
    );
  });

  it("throws SessionInvalidatedError when the user no longer exists (removed)", async () => {
    const prisma = fakePrisma(null);
    await expect(assertSessionStillValid(prisma, { userId: "u1", sessionVersion: 0 })).rejects.toBeInstanceOf(
      SessionInvalidatedError,
    );
  });

  it("looks up by the token's userId", async () => {
    const prisma = fakePrisma({ sessionVersion: 0, emailVerifiedAt: VERIFIED });
    await assertSessionStillValid(prisma, { userId: "the-user-id", sessionVersion: 0 });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "the-user-id" },
      select: { sessionVersion: true, emailVerifiedAt: true },
    });
  });

  it("throws SessionInvalidatedError for a token whose user's email is not verified (a session minted before the sign-in gate existed)", async () => {
    const prisma = fakePrisma({ sessionVersion: 0, emailVerifiedAt: null });
    await expect(assertSessionStillValid(prisma, { userId: "u1", sessionVersion: 0 })).rejects.toBeInstanceOf(
      SessionInvalidatedError,
    );
  });
});
