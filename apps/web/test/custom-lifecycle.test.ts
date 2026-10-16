/**
 * Custom REST lifecycle: Disconnect hides and keeps, Reconnect restores the
 * last activated configuration with fresh credentials (no new version, no
 * draft), and Delete configuration removes the configuration and nothing else.
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test" (every test truncates all tables); skipped when unset.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);
const FRESH = { token: "fresh-token-after-reconnect" };

describe.skipIf(!TEST_DATABASE_URL)("Custom REST lifecycle (real Postgres)", () => {
  let prisma: PrismaClient;
  let lifecycle: typeof import("@/lib/custom-provider/activation");
  let db: typeof import("@sla/db");
  let drafts: typeof import("@sla/custom-ticket");
  let savedKey: string | undefined;

  let organizationId: string;
  let otherOrganizationId: string;
  let integrationId: string;
  let otherIntegrationId: string;
  let zendeskId: string;

  const baseConfig = (displayName: string) => {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL("../../../packages/custom-ticket/dev/mock-helpdesk-config.json", import.meta.url)), "utf8"));
    raw.connection.baseUrl = "https://api.helpdesk.example.com";
    raw.auth = { type: "bearer" };
    raw.displayName = displayName;
    return raw;
  };

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    savedKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "test-key-material-for-lifecycle-0001";
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
    drafts = await import("@sla/custom-ticket");
    lifecycle = await import("@/lib/custom-provider/activation");
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    else process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = savedKey;
    await prisma?.$disconnect();
  });

  /** One organization's custom source: three versions with v2 active (v3 was saved later, then rolled back from), an unactivated draft, and stored business data. */
  async function seedCustom(orgName: string, provider: "custom" | "zendesk" = "custom") {
    const org = await prisma.organization.create({ data: { name: orgName } });
    const integration = await prisma.integration.create({
      data: {
        organizationId: org.id,
        provider,
        status: "connected",
        activeConfigVersion: provider === "custom" ? 2 : null,
        credentials: provider === "custom" ? ({ secrets: db.encryptCustomSecrets({ token: "old-token" }, { organizationId: org.id, integrationId: "pending" }) } as never) : ({ accessToken: "x" } as never),
        cursor: provider === "custom" ? ({ v: 1, watermark: "2026-09-17T09:00:00.000Z", backfillCompletedAt: "2026-09-17T09:00:00.000Z" } as never) : undefined,
        slaSupport: provider === "custom" ? ({ unsupportedKinds: [], limitations: [] } as never) : undefined,
      },
    });
    if (provider === "custom") {
      // Credentials are bound to the integration id, so seed them after it exists.
      await prisma.integration.update({
        where: { id: integration.id },
        data: { credentials: { secrets: db.encryptCustomSecrets({ token: "old-token" }, { organizationId: org.id, integrationId: integration.id }), reauthRequired: false } as never },
      });
      for (const version of [1, 2, 3]) {
        const parsed = drafts.parseConfig(baseConfig(`Version ${version}`));
        if (!parsed.ok) throw new Error("fixture invalid");
        await prisma.customProviderConfigVersion.create({
          data: { organizationId: org.id, integrationId: integration.id, version, schemaVersion: 1, config: parsed.config as never, configHash: `h${version}`, validatedAt: new Date() },
        });
      }
      await prisma.customActivationAudit.create({
        data: { organizationId: org.id, integrationId: integration.id, action: "activate", fromVersion: null, toVersion: 1, userId: "u1", details: {} },
      });
      await prisma.customProviderDraft.create({
        data: {
          organizationId: org.id,
          displayName: "Unactivated draft",
          config: baseConfig("Unactivated draft") as never,
          secrets: db.encryptCustomSecrets({ token: "draft-token" }, { organizationId: org.id, integrationId: "draft" }) as never,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await prisma.integrationSyncRun.create({ data: { organizationId: org.id, integrationId: integration.id, startedAt: at("09:00"), outcome: "ok", configVersion: 2 } });
    }

    const calendar = await prisma.businessCalendar.create({
      data: { organizationId: org.id, name: "24/7", versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } } },
      include: { versions: true },
    });
    const policy = await prisma.sLAPolicy.create({ data: { organizationId: org.id, name: "P" } });
    const policyVersion = await prisma.sLAPolicyVersion.create({
      data: { policyId: policy.id, version: 1, match: {}, targets: [{ kind: "first_response", minutes: 60 }], pauseOnStates: [], calendarVersionId: calendar.versions[0]!.id, warnAtPercent: [80], effectiveFrom: at("00:00") },
    });
    const kase = await prisma.case.create({ data: { organizationId: org.id, system: provider, sourceIntegrationId: integration.id, externalId: "T-1", priority: "high", openedAt: at("10:00") } });
    const raw = await prisma.rawEvent.create({ data: { integrationId: integration.id, providerEventId: "T-1:1", sourceHash: "s", payload: { id: "T-1" } } });
    await prisma.normalizedEvent.create({ data: { caseId: kase.id, sourceRawEventId: raw.id, type: "ticket_created", occurredAt: at("10:00"), actor: "customer", system: provider, sourceRole: "ticket_source" } });
    const commitment = await prisma.commitment.create({
      data: { caseId: kase.id, kind: "first_response", policyVersionId: policyVersion.id, calendarVersionId: calendar.versions[0]!.id, startedAt: at("10:00"), targetMinutes: 60, dueAt: at("11:00") },
    });
    await prisma.evaluation.create({ data: { commitmentId: commitment.id, evaluatedAt: at("10:30"), elapsedSeconds: 1800, remainingSeconds: 1800, status: "on_track", inputs: {} } });
    return { organizationId: org.id, integrationId: integration.id, caseId: kase.id };
  }

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    const a = await seedCustom("Org A");
    const b = await seedCustom("Org B");
    // The same organization also has a Zendesk source with its own case and events.
    const z = await prisma.integration.create({ data: { organizationId: a.organizationId, provider: "zendesk", status: "connected" } });
    const zCase = await prisma.case.create({ data: { organizationId: a.organizationId, system: "zendesk", sourceIntegrationId: z.id, externalId: "Z-1", priority: "high", openedAt: at("10:00") } });
    const zRaw = await prisma.rawEvent.create({ data: { integrationId: z.id, providerEventId: "Z-1:1", sourceHash: "z", payload: {} } });
    await prisma.normalizedEvent.create({ data: { caseId: zCase.id, sourceRawEventId: zRaw.id, type: "ticket_created", occurredAt: at("10:00"), actor: "customer", system: "zendesk", sourceRole: "ticket_source" } });
    organizationId = a.organizationId;
    integrationId = a.integrationId;
    otherOrganizationId = b.organizationId;
    otherIntegrationId = b.integrationId;
    zendeskId = z.id;
  });

  /** Every stored business row, per integration, so a before/after comparison catches any loss. */
  const business = async (forIntegrationId: string) => ({
    cases: await prisma.case.count({ where: { sourceIntegrationId: forIntegrationId } }),
    rawEvents: await prisma.rawEvent.count({ where: { integrationId: forIntegrationId } }),
    normalizedEvents: await prisma.normalizedEvent.count({ where: { sourceRawEvent: { integrationId: forIntegrationId } } }),
    commitments: await prisma.commitment.count({ where: { case: { sourceIntegrationId: forIntegrationId } } }),
    evaluations: await prisma.evaluation.count({ where: { commitment: { case: { sourceIntegrationId: forIntegrationId } } } }),
    syncRuns: await prisma.integrationSyncRun.count({ where: { integrationId: forIntegrationId } }),
  });
  const visibleCases = (org: string) => prisma.case.count({ where: { organizationId: org, ...db.CASE_SOURCE_CONNECTED } });
  const row = () => prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const versions = async () => (await prisma.customProviderConfigVersion.findMany({ where: { integrationId }, orderBy: { version: "asc" } })).map((v) => v.version);

  it("Disconnect stops syncing, clears credentials, hides the data and deletes nothing", async () => {
    const before = await business(integrationId);
    expect(await visibleCases(organizationId)).toBe(2);

    expect(await lifecycle.disconnectCustom(prisma, organizationId)).toBe(true);

    const after = await row();
    expect(after).toMatchObject({ status: "disconnected", credentials: null, activeConfigVersion: 2 });
    expect(after.disconnectedAt).not.toBeNull();
    expect(after.cursor).not.toBeNull();
    expect(await business(integrationId)).toEqual(before);
    expect(await versions()).toEqual([1, 2, 3]);
    expect(await prisma.customProviderDraft.count({ where: { organizationId } })).toBe(1);
    // Hidden by the shared visibility predicate: only the Zendesk case remains visible; Org B is unaffected.
    expect(await visibleCases(organizationId)).toBe(1);
    expect(await visibleCases(otherOrganizationId)).toBe(1);
  });

  it("Reconnect restores the last ACTIVATED version (not the latest saved) with fresh credentials, creating no version", async () => {
    await lifecycle.disconnectCustom(prisma, organizationId);
    const businessBefore = await business(integrationId);
    const auditsBefore = await prisma.customActivationAudit.count({ where: { integrationId } });

    const result = await lifecycle.reconnectCustom(prisma, { organizationId, userId: "u1", secrets: FRESH });
    expect(result).toEqual({ status: "reconnected", version: 2, integrationId });

    const after = await row();
    expect(after).toMatchObject({ status: "connected", activeConfigVersion: 2, disconnectedAt: null });
    expect(after.cursor).toMatchObject({ watermark: "2026-09-17T09:00:00.000Z" });
    // Fresh credentials, readable under the integration's binding.
    const stored = (after.credentials as { secrets: unknown }).secrets;
    expect(db.decryptCustomSecrets(stored, { organizationId, integrationId }, ["token"])).toEqual(FRESH);
    // Same version history, same rows; data visible again.
    expect(await versions()).toEqual([1, 2, 3]);
    expect(await business(integrationId)).toEqual(businessBefore);
    expect(await visibleCases(organizationId)).toBe(2);
    expect(await prisma.customActivationAudit.count({ where: { integrationId } })).toBe(auditsBefore + 1);
    expect(await prisma.customActivationAudit.findFirst({ where: { integrationId, action: "reconnect" } })).toMatchObject({ fromVersion: 2, toVersion: 2 });
  });

  it("an unactivated draft never replaces the last activated configuration", async () => {
    await lifecycle.disconnectCustom(prisma, organizationId);
    const draftBefore = await prisma.customProviderDraft.findUniqueOrThrow({ where: { organizationId } });

    // Activating the draft while disconnected is refused: reconnecting is the only way back.
    expect(await lifecycle.activateDraft(prisma, { organizationId, userId: "u1" })).toEqual({ status: "blocked", reason: "reconnect_first" });
    expect(await versions()).toEqual([1, 2, 3]);

    const result = await lifecycle.reconnectCustom(prisma, { organizationId, userId: "u1", secrets: FRESH });
    expect(result).toMatchObject({ status: "reconnected", version: 2 });
    expect((await row()).activeConfigVersion).toBe(2);
    expect(await versions()).toEqual([1, 2, 3]);
    // The draft is left exactly as it was.
    const draftAfter = await prisma.customProviderDraft.findUniqueOrThrow({ where: { organizationId } });
    expect(draftAfter.config).toEqual(draftBefore.config);
    expect(draftAfter.secrets).toEqual(draftBefore.secrets);
  });

  it("Reconnect refuses a connected source, missing or extra credentials, and another organization's request", async () => {
    expect(await lifecycle.reconnectCustom(prisma, { organizationId, userId: "u1", secrets: FRESH })).toEqual({ status: "not_disconnected" });
    await lifecycle.disconnectCustom(prisma, organizationId);
    expect(await lifecycle.reconnectCustom(prisma, { organizationId, userId: "u1", secrets: {} })).toEqual({ status: "invalid_secrets", missing: ["token"] });
    expect(await lifecycle.reconnectCustom(prisma, { organizationId, userId: "u1", secrets: { token: "" } })).toMatchObject({ status: "invalid_secrets" });
    expect(await lifecycle.reconnectCustom(prisma, { organizationId, userId: "u1", secrets: { token: "t", apiKey: "k" } })).toMatchObject({ status: "invalid_secrets" });
    expect((await row()).status).toBe("disconnected");
    // Org B was never disconnected; reconnecting "for" Org A did not touch it.
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: otherIntegrationId } })).status).toBe("connected");
  });

  it("Delete configuration removes only the configuration: draft, versions, pointer. Every business row stays", async () => {
    await lifecycle.disconnectCustom(prisma, organizationId);
    const before = await business(integrationId);
    const otherBefore = await business(otherIntegrationId);
    const zendeskBefore = await business(zendeskId);
    const totals = { cases: await prisma.case.count(), raw: await prisma.rawEvent.count(), events: await prisma.normalizedEvent.count(), commitments: await prisma.commitment.count(), orgs: await prisma.organization.count() };

    expect(await lifecycle.deleteCustomConfiguration(prisma, organizationId)).toBe("deleted");

    expect(await versions()).toEqual([]);
    expect(await prisma.customProviderDraft.count({ where: { organizationId } })).toBe(0);
    const after = await row();
    expect(after).toMatchObject({ status: "disconnected", activeConfigVersion: null, credentials: null, slaSupport: null });
    // The Integration row survives (its raw events would cascade), and so does everything stored.
    expect(await business(integrationId)).toEqual(before);
    // Raw SQL so this compiles both before N2.10 (nullable source) and after it (NOT NULL).
    const [sourceless] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "cases" WHERE "organizationId" = ${organizationId} AND "sourceIntegrationId" IS NULL`;
    expect(Number(sourceless!.n)).toBe(0);
    expect({ cases: await prisma.case.count(), raw: await prisma.rawEvent.count(), events: await prisma.normalizedEvent.count(), commitments: await prisma.commitment.count(), orgs: await prisma.organization.count() }).toEqual(totals);
    // Other integrations and organizations: configuration, drafts and data untouched.
    expect(await business(otherIntegrationId)).toEqual(otherBefore);
    expect(await business(zendeskId)).toEqual(zendeskBefore);
    expect(await prisma.customProviderConfigVersion.count({ where: { integrationId: otherIntegrationId } })).toBe(3);
    expect(await prisma.customProviderDraft.count({ where: { organizationId: otherOrganizationId } })).toBe(1);
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: otherIntegrationId } })).activeConfigVersion).toBe(2);
    // Still hidden while disconnected; nothing to reconnect on.
    expect(await visibleCases(organizationId)).toBe(1);
    expect(await lifecycle.reconnectCustom(prisma, { organizationId, userId: "u1", secrets: FRESH })).toEqual({ status: "no_active_configuration" });
  });

  it("Delete configuration is refused while the source is connected and changes nothing", async () => {
    expect(await lifecycle.deleteCustomConfiguration(prisma, organizationId)).toBe("connected");
    expect(await versions()).toEqual([1, 2, 3]);
    expect(await prisma.customProviderDraft.count({ where: { organizationId } })).toBe(1);
    expect((await row()).activeConfigVersion).toBe(2);
  });

  it("setting up again after deletion starts a fresh configuration lifecycle on the same row, over the kept data", async () => {
    await lifecycle.disconnectCustom(prisma, organizationId);
    await lifecycle.deleteCustomConfiguration(prisma, organizationId);
    const before = await business(integrationId);

    await drafts.saveDraft(prisma, organizationId, { config: baseConfig("Rebuilt"), secrets: FRESH });
    let result = await lifecycle.activateDraft(prisma, { organizationId, userId: "u1" });
    if (result.status === "needs_diff_review") result = await lifecycle.activateDraft(prisma, { organizationId, userId: "u1", confirmDiffHash: result.diff.hash ?? undefined });
    expect(result).toMatchObject({ status: "activated", version: 1, integrationId });

    expect(await versions()).toEqual([1]);
    expect(await row()).toMatchObject({ status: "connected", activeConfigVersion: 1, disconnectedAt: null });
    expect(await business(integrationId)).toEqual(before);
    expect(await visibleCases(organizationId)).toBe(2);
  });
});
