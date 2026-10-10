/**
 * Plan 09 §6.8, §13 row 14: activating a configuration version commits the
 * version, the activation pointer, `slaSupport`, the confirmed cancellations
 * and the audit row together, or none of them. Also: nothing is deleted and
 * finalized commitments are untouched.
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("activation is atomic (real Postgres)", () => {
  let prisma: PrismaClient;
  let activateDraft: typeof import("@/lib/custom-provider/activation").activateDraft;
  let organizationId: string;
  let integrationId: string;
  let openCommitmentId: string;
  let metCommitmentId: string;
  let savedKey: string | undefined;

  const baseConfig = () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL("../../../packages/custom-ticket/dev/mock-helpdesk-config.json", import.meta.url)), "utf8"));
    raw.connection.baseUrl = "https://api.helpdesk.example.com";
    raw.auth = { type: "bearer" };
    return raw;
  };

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    savedKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "test-key-material-for-activation-0001";
    prisma = (await import("@sla/db")).getPrismaClient();
    ({ activateDraft } = await import("@/lib/custom-provider/activation"));
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    const { encryptCustomSecrets } = await import("@sla/db");
    const { parseConfig, validateConfig, storedSlaSupport } = await import("@sla/custom-ticket");
    organizationId = (await prisma.organization.create({ data: { name: "Activation Org" } })).id;

    const v1 = parseConfig(baseConfig());
    if (!v1.ok) throw new Error("v1 invalid");
    const v1Report = validateConfig(v1.config, { allowPrivateHosts: false });
    if (!v1Report.ok) throw new Error(JSON.stringify(v1Report.diagnostics));
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "custom", status: "connected", activeConfigVersion: 1, credentials: {}, slaSupport: (storedSlaSupport(v1Report) ?? undefined) as never },
    });
    integrationId = integration.id;
    await prisma.customProviderConfigVersion.create({
      data: { organizationId, integrationId, version: 1, schemaVersion: 1, config: v1.config as never, configHash: "v1", validatedAt: new Date() },
    });

    const calendar = await prisma.businessCalendar.create({
      data: { organizationId, name: "24/7", versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } } },
      include: { versions: true },
    });
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "P" } });
    const policyVersion = await prisma.sLAPolicyVersion.create({
      data: { policyId: policy.id, version: 1, match: {}, targets: [{ kind: "first_response", minutes: 60 }, { kind: "resolution", minutes: 480 }], pauseOnStates: [], calendarVersionId: calendar.versions[0]!.id, warnAtPercent: [80], effectiveFrom: at("00:00") },
    });
    const mkCase = async (externalId: string) =>
      (await prisma.case.create({ data: { organizationId, system: "custom", sourceIntegrationId: integrationId, externalId, priority: "high", openedAt: at("10:00") } })).id;
    const common = { policyVersionId: policyVersion.id, calendarVersionId: calendar.versions[0]!.id, startedAt: at("10:00"), targetMinutes: 60, dueAt: at("11:00") };
    openCommitmentId = (await prisma.commitment.create({ data: { caseId: await mkCase("A"), kind: "first_response", ...common } })).id;
    metCommitmentId = (await prisma.commitment.create({ data: { caseId: await mkCase("B"), kind: "first_response", status: "met", closedAt: at("10:30"), ...common } })).id;

    // The draft turns first response and next reply off (resolution-only).
    const draft = baseConfig();
    draft.slaMode = "resolution_only";
    delete draft.comments;
    delete draft.commentMapping;
    await prisma.customProviderDraft.create({
      data: {
        organizationId,
        displayName: "Mock",
        config: draft,
        secrets: encryptCustomSecrets({ token: "fixture-token" }, { organizationId, integrationId: "draft" }) as never,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    else process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = savedKey;
    await prisma?.$disconnect();
  });

  const state = async () => ({
    versions: await prisma.customProviderConfigVersion.count({ where: { integrationId } }),
    active: (await prisma.integration.findUniqueOrThrow({ where: { id: integrationId }, select: { activeConfigVersion: true } })).activeConfigVersion,
    audits: await prisma.customActivationAudit.count({ where: { integrationId } }),
    open: (await prisma.commitment.findUniqueOrThrow({ where: { id: openCommitmentId } })).status,
    met: (await prisma.commitment.findUniqueOrThrow({ where: { id: metCommitmentId } })).status,
    commitments: await prisma.commitment.count(),
    drafts: await prisma.customProviderDraft.count({ where: { organizationId } }),
  });

  it("asks for confirmation first and writes nothing", async () => {
    const before = await state();
    const result = await activateDraft(prisma, { organizationId, userId: "u1" });
    expect(result.status).toBe("needs_confirmation");
    expect(await state()).toEqual(before);
  });

  it("a failure at the last step (the audit row) rolls back the version, the pointer and the cancellations", async () => {
    const preview = await activateDraft(prisma, { organizationId, userId: "u1" });
    if (preview.status !== "needs_confirmation") throw new Error(`unexpected ${preview.status}`);
    const hash = preview.impact.cancellation!.previewHash;
    const before = await state();

    const failing = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return (fn: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
            (target.$transaction as (...a: unknown[]) => Promise<unknown>).call(
              target,
              (tx: Record<string, unknown>) =>
                fn(new Proxy(tx, { get: (t, p) => (p === "customActivationAudit" ? { create: async () => { throw new Error("simulated failure at the audit step"); } } : Reflect.get(t, p)) })),
              ...rest,
            );
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as PrismaClient;
    await expect(activateDraft(failing, { organizationId, userId: "u1", confirmPreviewHash: hash })).rejects.toThrow("simulated failure");
    expect(await state()).toEqual(before); // version 1 still active, nothing cancelled, draft kept
    expect(before.open).not.toBe("cancelled");
  });

  it("a confirmed activation commits everything together: only the unfinalized commitment is cancelled, nothing is deleted", async () => {
    const preview = await activateDraft(prisma, { organizationId, userId: "u1" });
    if (preview.status !== "needs_confirmation") throw new Error(`unexpected ${preview.status}`);
    const before = await state();
    const result = await activateDraft(prisma, { organizationId, userId: "u1", confirmPreviewHash: preview.impact.cancellation!.previewHash });
    expect(result).toMatchObject({ status: "activated", version: 2, cancelled: 1 });
    expect(await state()).toMatchObject({ versions: 2, active: 2, audits: 1, open: "cancelled", met: "met", commitments: before.commitments, drafts: 0 });
  });
});
