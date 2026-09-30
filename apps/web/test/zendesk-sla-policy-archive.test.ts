/**
 * Phase 1.11 / E-9, revisited: a Zendesk SLA policy deleted (or deactivated)
 * in Zendesk has no "deletion event" of its own — only its absence from the
 * next full sla_policies listing. `runZendeskSlaPolicyImport` archives
 * (`SLAPolicy.archivedAt`) any previously-imported policy missing from the
 * latest manifest (`mapSlaPolicyManifestToRawEvent`), and matching for new
 * commitments must then skip it (`packages/commitments`'s
 * `archivedAt: null` filter).
 *
 * This suite also covers the real bug this mechanism had in practice: a
 * deleted policy stayed active indefinitely because `mapSlaPolicyManifestToRawEvent`
 * folded a content hash into its `providerEventId`, so `skipDuplicates`
 * silently no-op'd a manifest write whenever the live policy id-set
 * coincided with one already recorded — leaving `fetchedAt` stuck on an
 * older, since-stale row that `orderBy: fetchedAt desc` kept reading as
 * "the latest." Fixed the same way `mapJiraLinkManifestToRawEvent` already
 * was: a `randomUUID()`-based providerEventId, so every full listing gets
 * its own row. See the "oscillation" test below for the exact repro.
 *
 * Real Postgres, like next-reply-policy-import-e2e.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Zendesk SLA policy archival (real Postgres)", () => {
  let prisma: PrismaClient;
  let zendesk: typeof import("@sla/zendesk");
  let commitments: typeof import("@sla/commitments");
  // The Zendesk importer no longer depends on @sla/commitments (N1.12): the caller supplies the default calendar.
  const ensureDefaultCalendar = (organizationId: string) =>
    commitments.ensureDefaultCalendarVersion(prisma, organizationId);

  let organizationId: string;
  let integrationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    zendesk = await import("@sla/zendesk");
    commitments = await import("@sla/commitments");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Archive Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    integrationId = integration.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function writePolicySnapshot(id: number, title: string) {
    // createMany + skipDuplicates, like the real writeRawEvents helper
    // backfill.ts uses — re-writing an unchanged snapshot (same id, same
    // hard-coded hash below) is a no-op, not an error, e.g. when a policy
    // reappears in a listing after having been deleted and re-created.
    await prisma.rawEvent.createMany({
      data: [
        {
          integrationId,
          providerEventId: `sla_policy:${id}:h-${id}`,
          sourceHash: `h-${id}`,
          payload: {
            id,
            title,
            policy_metrics: [{ priority: null, metric: "first_reply_time", target: 60, business_hours: true }],
          },
        },
      ],
      skipDuplicates: true,
    });
  }

  async function writeManifest(policyIds: number[]) {
    const manifest = zendesk.mapSlaPolicyManifestToRawEvent(policyIds);
    // createMany + skipDuplicates, exactly like the real writeRawEvents
    // helper backfill.ts uses. Unlike a per-policy snapshot, the manifest's
    // providerEventId is a fresh randomUUID on every call (see
    // mapSlaPolicyManifestToRawEvent's doc comment), so skipDuplicates never
    // actually finds a duplicate here — every call writes a genuinely new
    // row with its own `fetchedAt`, even when called twice with identical
    // policyIds. That's the fix under test in the oscillation scenario below.
    await prisma.rawEvent.createMany({
      data: [
        {
          integrationId,
          providerEventId: manifest.providerEventId,
          sourceHash: manifest.sourceHash,
          payload: manifest.payload as object,
        },
      ],
      skipDuplicates: true,
    });
  }

  it("leaves every policy unarchived when no manifest has ever been written", async () => {
    await writePolicySnapshot(1, "Standard");
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    const policy = await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId } });
    expect(policy.archivedAt).toBeNull();
  });

  it("archives a policy missing from the latest manifest, and excludes it from matching new commitments", async () => {
    await writePolicySnapshot(1, "Standard");
    await writePolicySnapshot(2, "Urgent");
    await writeManifest([1, 2]);
    const first = await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    expect(first.policiesArchived).toBe(0);
    expect(first.policyVersionsCreated).toBe(2);

    const policiesBefore = await prisma.sLAPolicy.findMany({ where: { organizationId }, orderBy: { externalId: "asc" } });
    expect(policiesBefore.every((p) => p.archivedAt === null)).toBe(true);

    // Policy 2 is deleted in Zendesk: the next full listing (and manifest) omits it.
    await writeManifest([1]);
    const second = await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    expect(second.policiesArchived).toBe(1);

    const policiesAfter = await prisma.sLAPolicy.findMany({ where: { organizationId }, orderBy: { externalId: "asc" } });
    const standard = policiesAfter.find((p) => p.name === "Standard")!;
    const urgent = policiesAfter.find((p) => p.name === "Urgent")!;
    expect(standard.archivedAt).toBeNull();
    expect(urgent.archivedAt).not.toBeNull();

    // A new case that would only have matched the archived "Urgent" policy
    // (no other policy's match criteria fit) now matches nothing at all,
    // rather than silently keying off a deleted policy.
    const zCase = await prisma.case.create({
      data: { organizationId, externalId: "case-1", openedAt: new Date("2026-09-17T10:00:00.000Z") },
    });
    const pipelineResult = await commitments.runCommitmentPipeline(prisma, organizationId);
    expect(pipelineResult.casesWithNoMatchingPolicy).toBe(0); // "Standard" (unrestricted match) still applies
    const created = await prisma.commitment.findFirst({ where: { caseId: zCase.id } });
    expect(created?.policyVersionId).toBe(
      (await prisma.sLAPolicyVersion.findFirstOrThrow({ where: { policy: { name: "Standard" } } })).id,
    );
  });

  it("never archives a policy still present in the latest manifest", async () => {
    await writePolicySnapshot(1, "Standard");
    await writeManifest([1]);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    // Re-running with the same live id changes nothing.
    await writeManifest([1]);
    const result = await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    expect(result.policiesArchived).toBe(0);

    const policy = await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId } });
    expect(policy.archivedAt).toBeNull();
  });

  it("regression: archives a policy even when the live id-set oscillates back to a previously-seen composition", async () => {
    // This is the exact real-world sequence the content-hash-dedup bug
    // masked: [1,2] -> [1,2,3] -> [1,2] again. The third manifest's content
    // is identical to the first's, which is exactly what made the old
    // (content-hashed) providerEventId collide and silently skip the write.
    await writePolicySnapshot(1, "Standard");
    await writePolicySnapshot(2, "Urgent");
    await writePolicySnapshot(3, "Enterprise");

    await writeManifest([1, 2]);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    await writeManifest([1, 2, 3]);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    const enterprise = await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId, name: "Enterprise" } });
    expect(enterprise.archivedAt).toBeNull();

    // Policy 3 is deleted in Zendesk. The new live set [1,2] is identical in
    // *content* to the very first manifest written above.
    await writeManifest([1, 2]);
    const result = await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    expect(result.policiesArchived).toBe(1);
    const afterward = await prisma.sLAPolicy.findFirstOrThrow({ where: { id: enterprise.id } });
    expect(afterward.archivedAt).not.toBeNull();
  });

  it("does not archive any policy when a sync fails and no fresh manifest is written", async () => {
    await writePolicySnapshot(1, "Standard");
    await writePolicySnapshot(2, "Urgent");
    await writeManifest([1, 2]);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    // Policy 2 is deleted in Zendesk, but the sync that would discover this
    // fails before it can write a fresh manifest (e.g. the listing request
    // itself errors) — exactly what `backfillSlaPolicies` guarantees: it
    // only ever writes a manifest after a full listing completes
    // successfully, never a partial one. `runZendeskSlaPolicyImport` still
    // runs this cycle (packages/worker's cycle.ts runs normalization even
    // for an integration whose ingest just failed), using whatever manifest
    // is still the latest.
    const result = await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    expect(result.policiesArchived).toBe(0);
    const policies = await prisma.sLAPolicy.findMany({ where: { organizationId } });
    expect(policies.every((p) => p.archivedAt === null)).toBe(true);
  });

  it("never touches a native policy — it has no externalId and is never in a Zendesk manifest", async () => {
    const nativePolicy = await prisma.sLAPolicy.create({
      data: { organizationId, name: "Native VIP policy", source: "native" },
    });
    await writePolicySnapshot(1, "Standard");
    await writeManifest([1]); // the native policy's id is never a Zendesk policy id
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    const unchanged = await prisma.sLAPolicy.findUniqueOrThrow({ where: { id: nativePolicy.id } });
    expect(unchanged.archivedAt).toBeNull();
    expect(unchanged.deactivatedAt).toBeNull();
    expect(unchanged.source).toBe("native");
  });

  it("leaves a historical commitment referencing a retired imported policy readable and unchanged", async () => {
    await writePolicySnapshot(1, "Urgent");
    await writeManifest([1]);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    const policyVersion = await prisma.sLAPolicyVersion.findFirstOrThrow({
      where: { policy: { organizationId, name: "Urgent" } },
      include: { calendarVersion: true },
    });
    const zCase = await prisma.case.create({
      data: { organizationId, externalId: "case-historical", openedAt: new Date("2026-09-01T00:00:00.000Z") },
    });
    const commitment = await prisma.commitment.create({
      data: {
        caseId: zCase.id,
        kind: "first_response",
        policyVersionId: policyVersion.id,
        calendarVersionId: policyVersion.calendarVersionId,
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
        targetMinutes: 60,
        dueAt: new Date("2026-09-01T01:00:00.000Z"),
        status: "met",
        closedAt: new Date("2026-09-01T00:30:00.000Z"),
      },
    });

    // The policy is deleted in Zendesk and archived by the next sync.
    await writeManifest([]);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    const archivedPolicy = await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId, name: "Urgent" } });
    expect(archivedPolicy.archivedAt).not.toBeNull();

    // The historical commitment is completely untouched — same policy
    // version, same status, same everything — and still fully readable.
    const stillReadable = await prisma.commitment.findUniqueOrThrow({ where: { id: commitment.id } });
    expect(stillReadable).toMatchObject({
      policyVersionId: policyVersion.id,
      status: "met",
      targetMinutes: 60,
    });
  });

  it("retired imported policy cannot be selected by matching for a new ticket", async () => {
    await writePolicySnapshot(1, "Urgent");
    await writeManifest([1]);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    await writeManifest([]); // deleted in Zendesk
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    const zCase = await prisma.case.create({
      data: { organizationId, externalId: "case-no-match", openedAt: new Date("2026-09-17T10:00:00.000Z") },
    });
    // With every SLAPolicy in the org archived, `runCommitmentPipeline`
    // short-circuits before loading any case at all (no active policy
    // versions to match against) — so `casesConsidered`/`casesWithNoMatchingPolicy`
    // both stay 0 rather than reflecting "this case matched nothing." The
    // one assertion that actually proves the retired policy can't be
    // selected is that no commitment gets created for the new case.
    await commitments.runCommitmentPipeline(prisma, organizationId);
    const created = await prisma.commitment.findFirst({ where: { caseId: zCase.id } });
    expect(created).toBeNull();
  });

  it("a policy recreated in Zendesk after deletion is un-archived and can be matched again", async () => {
    await writePolicySnapshot(1, "Urgent");
    await writeManifest([1]);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    await writeManifest([]); // deleted in Zendesk
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    const archived = await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId, name: "Urgent" } });
    expect(archived.archivedAt).not.toBeNull();

    // The policy reappears in a fresh Zendesk listing (recreated, or a
    // false-positive deletion that Zendesk itself reversed).
    await writePolicySnapshot(1, "Urgent");
    await writeManifest([1]);
    const result = await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    expect(result.policiesArchived).toBe(0);

    const recreated = await prisma.sLAPolicy.findUniqueOrThrow({ where: { id: archived.id } });
    expect(recreated.archivedAt).toBeNull();

    const zCase = await prisma.case.create({
      data: { organizationId, externalId: "case-recreated", openedAt: new Date("2026-09-17T10:00:00.000Z") },
    });
    const pipelineResult = await commitments.runCommitmentPipeline(prisma, organizationId);
    expect(pipelineResult.casesWithNoMatchingPolicy).toBe(0);
    const created = await prisma.commitment.findFirst({ where: { caseId: zCase.id } });
    expect(created?.policyVersionId).toBe(
      (await prisma.sLAPolicyVersion.findFirstOrThrow({ where: { policy: { id: archived.id } }, orderBy: { version: "desc" } })).id,
    );
  });
});
