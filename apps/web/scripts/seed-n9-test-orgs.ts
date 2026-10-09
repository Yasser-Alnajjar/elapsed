/**
 * Local development only: creates (or refreshes) two isolated organizations and
 * three verified users for manually testing Custom REST (N9).
 *
 *   pnpm --filter @sla/web exec tsx scripts/seed-n9-test-orgs.ts
 *
 * - "N9 Test Org A": Beta flag ON. An owner and a member.
 * - "N9 Test Org B": Beta flag OFF. An owner. Used to check tenant isolation and the flag.
 *
 * Passwords are generated per run and written to ./.local/n9-test-credentials.txt
 * (gitignored); they are never printed. Refuses to run unless DATABASE_URL points
 * at localhost.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { getPrismaClient } from "@sla/db";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing to run: DATABASE_URL is not a localhost database.");
  process.exit(1);
}

const prisma = getPrismaClient();
const USERS = [
  { org: "N9 Test Org A", flag: true, email: "n9-owner-a@example.test", role: "owner" as const },
  { org: "N9 Test Org A", flag: true, email: "n9-member-a@example.test", role: "member" as const },
  { org: "N9 Test Org B", flag: false, email: "n9-owner-b@example.test", role: "owner" as const },
];

const lines: string[] = ["# Local N9 test accounts (dev database only). Sign in at http://localhost:3000/sign-in"];
for (const spec of USERS) {
  const password = randomBytes(12).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);
  let org = await prisma.organization.findFirst({ where: { name: spec.org } });
  if (!org) org = await prisma.organization.create({ data: { name: spec.org, trialEndsAt: new Date(Date.now() + 14 * 86_400_000) } });
  await prisma.organization.update({ where: { id: org.id }, data: { customProviderEnabled: spec.flag } });
  await prisma.user.upsert({
    where: { email: spec.email },
    create: { organizationId: org.id, email: spec.email, passwordHash, role: spec.role, name: spec.email.split("@")[0], emailVerifiedAt: new Date() },
    update: { passwordHash, role: spec.role, emailVerifiedAt: new Date(), sessionVersion: { increment: 1 } },
  });
  lines.push(`${spec.org} | ${spec.role} | ${spec.email} | ${password}`);
}
mkdirSync(join(process.cwd(), "../../.local"), { recursive: true });
writeFileSync(join(process.cwd(), "../../.local/n9-test-credentials.txt"), lines.join("\n") + "\n", { mode: 0o600 });
console.log("Seeded 2 organizations and 3 users. Credentials: .local/n9-test-credentials.txt");
await prisma.$disconnect();
