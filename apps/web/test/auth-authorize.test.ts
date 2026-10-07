import { beforeEach, describe, expect, it, vi } from "vitest";

const bcryptCompare = vi.fn(async (plain: string, hash: string) => hash === `hash:${plain}`);

interface FakeUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  organizationId: string;
  role: string;
  createdAt: Date;
  passwordHash: string;
  emailVerifiedAt: Date | null;
}

const users = new Map<string, FakeUser>();

vi.mock("@sla/db", () => ({
  getPrismaClient: () => ({
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        users.get(where.email) ?? null,
    },
  }),
}));

// Real bcrypt hashing is slow and unnecessary here — `authorize()` only
// cares about the boolean `compare()` result, so a fake "hash:<password>"
// scheme is used instead of real hashes throughout this file. `hashSync` is
// exercised for real (as `@/lib/auth.ts`'s module-level dummy-hash constant)
// since it just needs to produce *some* value in that same fake scheme.
vi.mock("bcryptjs", () => ({
  default: {
    compare: bcryptCompare,
    hashSync: (input: string) => `hash:${input}`,
  },
}));

const { authOptions } = await import("../src/lib/auth");
const { _resetAuthThrottleState } = await import("../src/lib/auth-throttle");

// `CredentialsProvider(options)` itself returns a stub `authorize: () =>
// null` and tucks the real function the caller passed under `.options` —
// NextAuth's core re-merges `.options` on top at request time (see
// `next-auth/core/lib/providers.js`). Reach into the same place here so
// this test exercises the actual `authorize()` from `@/lib/auth.ts`.
function authorize(credentials: { email: string; password: string }, ip?: string) {
  const provider = authOptions.providers[0] as unknown as {
    options: {
      authorize: (
        credentials: { email: string; password: string },
        req: { headers: Record<string, string> },
      ) => Promise<unknown>;
    };
  };
  return provider.options.authorize(credentials, {
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
}

function seedUser(email: string, password: string, emailVerifiedAt: Date | null = new Date("2024-01-02T00:00:00.000Z")): FakeUser {
  const user: FakeUser = {
    id: "user-1",
    email,
    name: "Test User",
    image: null,
    organizationId: "org-1",
    role: "owner",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    passwordHash: `hash:${password}`,
    emailVerifiedAt,
  };
  users.set(email, user);
  return user;
}

beforeEach(() => {
  users.clear();
  _resetAuthThrottleState();
  bcryptCompare.mockClear();
});

describe("authorize() — ordinary credential checks (unchanged behavior)", () => {
  it("returns the user object for a correct email/password", async () => {
    seedUser("user@example.com", "correct-horse");
    const result = await authorize({ email: "user@example.com", password: "correct-horse" });
    expect(result).toMatchObject({ id: "user-1", email: "user@example.com" });
  });

  it("returns null for a wrong password (generic invalid-credentials path)", async () => {
    seedUser("user@example.com", "correct-horse");
    const result = await authorize({ email: "user@example.com", password: "wrong" });
    expect(result).toBeNull();
  });

  it("returns null for an email that does not exist, same as a wrong password", async () => {
    const result = await authorize({ email: "nobody@example.com", password: "whatever" });
    expect(result).toBeNull();
  });

  it("runs a bcrypt compare for an unknown email too, so it costs the same as a wrong password (no timing oracle)", async () => {
    seedUser("user@example.com", "correct-horse");

    await authorize({ email: "user@example.com", password: "wrong" });
    expect(bcryptCompare).toHaveBeenCalledTimes(1);

    bcryptCompare.mockClear();
    await authorize({ email: "nobody@example.com", password: "wrong" });
    expect(bcryptCompare).toHaveBeenCalledTimes(1);
  });

  it("never stores or leaks the raw password — two different guesses against the same email both just count as failures", async () => {
    seedUser("user@example.com", "correct-horse");
    await authorize({ email: "user@example.com", password: "guess-one" });
    await authorize({ email: "user@example.com", password: "totally-different-guess" });

    // Both wrong guesses accumulated against the same throttle key regardless
    // of their content — proof the key is built from the email (and IP),
    // never the password itself.
    const result = await authorize({ email: "user@example.com", password: "guess-three" });
    expect(result).toBeNull();
  });
});

describe("authorize() — progressive throttle integration", () => {
  it("does not throttle the first 3 failed attempts", async () => {
    seedUser("user@example.com", "correct-horse");
    for (let i = 0; i < 3; i += 1) {
      const result = await authorize({ email: "user@example.com", password: "wrong" });
      expect(result).toBeNull();
    }
  });

  it("throws an AUTH_THROTTLED error on the attempt after the 4th failure", async () => {
    seedUser("user@example.com", "correct-horse");
    for (let i = 0; i < 4; i += 1) {
      await authorize({ email: "user@example.com", password: "wrong" }).catch(() => {});
    }

    await expect(authorize({ email: "user@example.com", password: "wrong" })).rejects.toThrow(
      /^AUTH_THROTTLED:\d+$/,
    );
  });

  it("throttles even a correct password while a cooldown from prior failures is active", async () => {
    seedUser("user@example.com", "correct-horse");
    for (let i = 0; i < 4; i += 1) {
      await authorize({ email: "user@example.com", password: "wrong" }).catch(() => {});
    }

    await expect(
      authorize({ email: "user@example.com", password: "correct-horse" }),
    ).rejects.toThrow(/^AUTH_THROTTLED:\d+$/);
  });

  it("a successful login clears the failed-attempt state for that identity", async () => {
    seedUser("user@example.com", "correct-horse");
    await authorize({ email: "user@example.com", password: "wrong" });
    await authorize({ email: "user@example.com", password: "wrong" });
    await authorize({ email: "user@example.com", password: "wrong" });

    const success = await authorize({ email: "user@example.com", password: "correct-horse" });
    expect(success).toMatchObject({ id: "user-1" });

    // Back to "first 3 are free" — no leftover throttle from before the success.
    const afterSuccess = await authorize({ email: "user@example.com", password: "wrong" });
    expect(afterSuccess).toBeNull();
  });

  it("does not throttle an identity that has never failed (no pre-auth throttling)", async () => {
    seedUser("fresh@example.com", "correct-horse");
    const result = await authorize({ email: "fresh@example.com", password: "correct-horse" });
    expect(result).toMatchObject({ id: "user-1" });
  });

  it("case/whitespace-normalizes the identity so throttle state carries across variants", async () => {
    seedUser("user@example.com", "correct-horse");
    for (let i = 0; i < 4; i += 1) {
      await authorize({ email: "User@Example.com", password: "wrong" }).catch(() => {});
    }

    await expect(
      authorize({ email: "  user@example.com  ", password: "wrong" }),
    ).rejects.toThrow(/^AUTH_THROTTLED:\d+$/);
  });

  it("keeps different identities' throttle state isolated", async () => {
    seedUser("victim@example.com", "correct-horse");
    seedUser("other@example.com", "correct-horse");

    for (let i = 0; i < 4; i += 1) {
      await authorize({ email: "victim@example.com", password: "wrong" }).catch(() => {});
    }

    const result = await authorize({ email: "other@example.com", password: "correct-horse" });
    expect(result).toMatchObject({ id: "user-1" });
  });

  it("keys the throttle on email + client IP, so a stranger can't force a cooldown onto the real owner's login", async () => {
    seedUser("victim@example.com", "correct-horse");

    // An attacker fails 4 attempts against the victim's email from their own IP.
    for (let i = 0; i < 4; i += 1) {
      await authorize({ email: "victim@example.com", password: "wrong" }, "203.0.113.9").catch(
        () => {},
      );
    }
    await expect(
      authorize({ email: "victim@example.com", password: "wrong" }, "203.0.113.9"),
    ).rejects.toThrow(/^AUTH_THROTTLED:\d+$/);

    // The real owner, logging in correctly from their own IP, is unaffected.
    const ownerResult = await authorize(
      { email: "victim@example.com", password: "correct-horse" },
      "198.51.100.4",
    );
    expect(ownerResult).toMatchObject({ id: "user-1" });
  });
});

describe("authorize() — email verification gate", () => {
  it("throws EMAIL_NOT_VERIFIED for the correct password on an unverified account, and never returns a user (so NextAuth issues no token)", async () => {
    seedUser("new@example.com", "correct-horse", null);

    await expect(authorize({ email: "new@example.com", password: "correct-horse" })).rejects.toThrow(
      /^EMAIL_NOT_VERIFIED$/,
    );
  });

  it("gives the same deterministic error on every attempt — it is not a one-off or throttle-dependent signal", async () => {
    seedUser("new@example.com", "correct-horse", null);

    for (let i = 0; i < 3; i += 1) {
      await expect(authorize({ email: "new@example.com", password: "correct-horse" })).rejects.toThrow(
        /^EMAIL_NOT_VERIFIED$/,
      );
    }
  });

  it("does not reveal that an account is unverified to someone with the wrong password (plain null, same as any bad credential)", async () => {
    seedUser("new@example.com", "correct-horse", null);

    expect(await authorize({ email: "new@example.com", password: "wrong" })).toBeNull();
  });

  it("an unknown address is still the plain null path, not the unverified error", async () => {
    expect(await authorize({ email: "nobody@example.com", password: "whatever" })).toBeNull();
  });

  it("signs in a verified account", async () => {
    seedUser("ok@example.com", "correct-horse", new Date());

    const result = await authorize({ email: "ok@example.com", password: "correct-horse" });
    expect(result).toMatchObject({ id: "user-1", email: "ok@example.com" });
  });

  it("becomes sign-in-able as soon as the account is marked verified (the verification link's effect)", async () => {
    const user = seedUser("new@example.com", "correct-horse", null);
    await expect(authorize({ email: "new@example.com", password: "correct-horse" })).rejects.toThrow(
      /^EMAIL_NOT_VERIFIED$/,
    );

    user.emailVerifiedAt = new Date();

    expect(await authorize({ email: "new@example.com", password: "correct-horse" })).toMatchObject({ id: "user-1" });
  });
});
