/**
 * Connect links (N5.3, D26) against a real Postgres: a link works once, only
 * for its own organization and provider, and expires. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("integration connect links (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const org = (name: string) =>
    prisma.organization.create({
      data: { name, users: { create: { email: `${name}@x.com`, passwordHash: "x", role: "owner" } } },
      include: { users: true },
    });

  it("stores only a hash, and resolves the raw token to its organization and provider", async () => {
    const a = await org("a");
    const { token } = await db.createConnectLink(prisma, {
      organizationId: a.id,
      provider: "jira",
      intendedFor: "Dana",
      createdByUserId: a.users[0]!.id,
    });
    const row = await prisma.integrationConnectLink.findFirstOrThrow();
    expect(row.tokenHash).not.toContain(token);
    const link = await db.resolveConnectLink(prisma, token);
    expect(link).toMatchObject({ organizationId: a.id, provider: "jira", intendedFor: "Dana", organizationName: "a" });
  });

  it("is single use: of two concurrent consumes exactly one wins, and a consumed link no longer resolves", async () => {
    const a = await org("a");
    const { token } = await db.createConnectLink(prisma, { organizationId: a.id, provider: "linear", createdByUserId: a.users[0]!.id });
    const link = await db.resolveConnectLink(prisma, token);
    const results = await Promise.all([1, 2, 3].map(() => db.consumeConnectLink(prisma, { id: link.id, organizationId: a.id, provider: "linear" })));
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(db.resolveConnectLink(prisma, token)).rejects.toMatchObject({ reason: "consumed" });
  });

  it("cannot be consumed for another organization or provider", async () => {
    const a = await org("a");
    const b = await org("b");
    const { token } = await db.createConnectLink(prisma, { organizationId: a.id, provider: "jira", createdByUserId: a.users[0]!.id });
    const link = await db.resolveConnectLink(prisma, token);
    expect(await db.consumeConnectLink(prisma, { id: link.id, organizationId: b.id, provider: "jira" })).toBe(false);
    expect(await db.consumeConnectLink(prisma, { id: link.id, organizationId: a.id, provider: "linear" })).toBe(false);
    expect(await db.consumeConnectLink(prisma, { id: link.id, organizationId: a.id, provider: "jira" })).toBe(true);
  });

  it("expires", async () => {
    const a = await org("a");
    const past = new Date(Date.now() - db.CONNECT_LINK_TTL_MS - 1000);
    const { token, id } = await db.createConnectLink(prisma, { organizationId: a.id, provider: "jira", createdByUserId: a.users[0]!.id, now: past });
    await expect(db.resolveConnectLink(prisma, token)).rejects.toMatchObject({ reason: "expired" });
    expect(await db.consumeConnectLink(prisma, { id, organizationId: a.id, provider: "jira" })).toBe(false);
  });

  it("rejects an unknown token, lists only the organization's active links, and revokes only its own", async () => {
    const a = await org("a");
    const b = await org("b");
    await expect(db.resolveConnectLink(prisma, "nope")).rejects.toMatchObject({ reason: "not_found" });
    const { id } = await db.createConnectLink(prisma, { organizationId: a.id, provider: "jira", createdByUserId: a.users[0]!.id });
    await db.createConnectLink(prisma, { organizationId: b.id, provider: "jira", createdByUserId: b.users[0]!.id });
    expect(await db.listActiveConnectLinks(prisma, a.id)).toHaveLength(1);
    expect(await db.revokeConnectLink(prisma, b.id, id)).toBe(false);
    expect(await db.revokeConnectLink(prisma, a.id, id)).toBe(true);
    expect(await db.listActiveConnectLinks(prisma, a.id)).toHaveLength(0);
  });
});
